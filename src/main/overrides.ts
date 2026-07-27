import { createHash } from 'crypto'
import { diff_match_patch } from 'diff-match-patch'
import type { OverrideEntry } from '@shared/schemas'
import type { OverrideStatus } from '@shared/types'
import { overrideMatches } from '@shared/glob'
import { declaredNames, describeRange, isExpressionSnippet, parses } from '@shared/analyze'
import { applyWatch } from './watch'
import { applyExecutionMap } from './mapping'
import type { MapFunction } from '@shared/types'

const dmp = new diff_match_patch()
dmp.Match_Threshold = 0.4
dmp.Match_Distance = 4000
dmp.Patch_DeleteThreshold = 0.4

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function stripHash(url: string): string {
  const i = url.indexOf('#')
  return i === -1 ? url : url.slice(0, i)
}

function fileLabel(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    return seg || u.hostname
  } catch {
    return url
  }
}

export type ApplyResult = {
  overrideId: string
  url: string
  kind: 'edit' | 'expose' | 'watch' | 'map'
  status: OverrideStatus
  message?: string
  label?: string
}

/**
 * Localiza a seleção no corpo atual. Se houver mais de uma ocorrência,
 * desambigua pelo contexto (prefix/suffix gravados na criação).
 */
function locateSelection(body: string, selection: string, prefix: string, suffix: string): number {
  const positions: number[] = []
  let i = body.indexOf(selection)
  while (i !== -1 && positions.length < 64) {
    positions.push(i)
    i = body.indexOf(selection, i + 1)
  }
  if (positions.length === 0) return -1
  if (positions.length === 1) return positions[0]
  let best = positions[0]
  let bestScore = -1
  for (const pos of positions) {
    const before = body.slice(Math.max(0, pos - prefix.length), pos)
    const after = body.slice(pos + selection.length, pos + selection.length + suffix.length)
    let score = 0
    for (let k = 1; k <= Math.min(before.length, prefix.length); k++) {
      if (before[before.length - k] === prefix[prefix.length - k]) score++
      else break
    }
    for (let k = 0; k < Math.min(after.length, suffix.length); k++) {
      if (after[k] === suffix[k]) score++
      else break
    }
    if (score > bestScore) {
      bestScore = score
      best = pos
    }
  }
  return best
}

function applyExpose(
  body: string,
  expose: NonNullable<OverrideEntry['expose']>
): { text: string; status: OverrideStatus; message?: string } {
  const { name, selection, prefix, suffix } = expose
  const pos = locateSelection(body, selection, prefix, suffix)
  if (pos === -1) {
    return {
      text: body,
      status: 'failed',
      message: `Trecho de "${name}" não encontrado — o arquivo mudou no servidor. Refaça a seleção.`
    }
  }
  const nameLit = JSON.stringify(name)
  let transformed: string | null = null

  // O AST do arquivo inteiro sabe o que a seleção é *no contexto dela*, o que a
  // análise do trecho isolado erra (`{a:1}` sozinho parece um bloco). Quando o
  // arquivo não parseia, cai na análise do trecho.
  const info = describeRange(body, pos, pos + selection.length)
  const ehExpressao =
    info !== null ? info.kind === 'expression' || info.kind === 'function' : isExpressionSnippet(selection)

  if (ehExpressao) {
    const replacement = `(globalThis[${nameLit}] = (${selection}\n))`
    transformed = body.slice(0, pos) + replacement + body.slice(pos + selection.length)
  } else {
    const names = declaredNames(selection)
    if (names.length > 0) {
      const value = names.length === 1 ? names[0] : `{ ${names.join(', ')} }`
      const injection = `\n;try { globalThis[${nameLit}] = ${value}; } catch (e) {}\n`
      const end = pos + selection.length
      transformed = body.slice(0, end) + injection + body.slice(end)
    }
  }

  if (transformed === null) {
    return {
      text: body,
      status: 'failed',
      message: `Seleção de "${name}" não é uma expressão nem uma declaração nomeada — não dá para expor com segurança.`
    }
  }

  // Se o arquivo original parseava e o transformado não, a transformação quebraria o site: reverte.
  if (parses(body) && !parses(transformed)) {
    return {
      text: body,
      status: 'failed',
      message: `Expor "${name}" quebraria a sintaxe do arquivo. Servindo original.`
    }
  }
  return { text: transformed, status: 'applied' }
}

/**
 * Motor de overrides. Nunca serve cópia local: reaplica o diff
 * (originalText -> editedText) sobre o corpo que o servidor entregou agora.
 */
export class OverrideEngine {
  /**
   * `patch_make` roda um diff sobre o arquivo inteiro. Como original e editado
   * só mudam quando o dev salva, guardamos os patches por override — senão o
   * diff de um bundle grande é refeito a cada requisição interceptada.
   */
  private patchesPorOverride = new Map<string, { assinatura: string; patches: unknown[] }>()

  constructor(private getAll: () => OverrideEntry[]) {}

  private patchesDe(o: OverrideEntry): unknown[] {
    const assinatura = `${o.updatedAt}:${o.originalText.length}:${o.editedText?.length ?? 0}`
    const guardado = this.patchesPorOverride.get(o.id)
    if (guardado && guardado.assinatura === assinatura) return guardado.patches
    const patches = dmp.patch_make(o.originalText, o.editedText ?? '')
    this.patchesPorOverride.set(o.id, { assinatura, patches })
    return patches
  }

  enabledFor(url: string): OverrideEntry[] {
    const key = stripHash(url)
    return this.getAll().filter((o) => o.enabled && overrideMatches(o, key))
  }

  hasAny(): boolean {
    return this.getAll().some((o) => o.enabled)
  }

  apply(
    url: string,
    body: string
  ): { text: string; results: ApplyResult[]; catalog: { fileId: string; functions: MapFunction[] } | null } {
    const entries = this.enabledFor(url)
    const results: ApplyResult[] = []
    let catalog: { fileId: string; functions: MapFunction[] } | null = null
    let text = body

    for (const o of entries.filter((e) => e.kind === 'edit')) {
      if (o.editedText === undefined) continue
      const base = { overrideId: o.id, url, kind: 'edit' as const, label: fileLabel(url) }
      if (sha256(text) === o.originalHash) {
        text = o.editedText
        results.push({ ...base, status: 'applied' })
        continue
      }
      const patches = this.patchesDe(o)
      const [patched, oks] = dmp.patch_apply(patches as never, text) as [string, boolean[]]
      if (oks.length > 0 && oks.every(Boolean)) {
        text = patched
        results.push({
          ...base,
          status: 'fuzzy',
          message: `${fileLabel(url)}: o arquivo mudou no servidor; edição reaplicada via fuzzy patch. Confira o resultado.`
        })
      } else {
        results.push({
          ...base,
          status: 'failed',
          message: `${fileLabel(url)}: o arquivo mudou no servidor e o patch não pôde ser aplicado. Servindo o original.`
        })
      }
    }

    for (const o of entries.filter((e) => e.kind === 'expose')) {
      if (!o.expose) continue
      const r = applyExpose(text, o.expose)
      text = r.text
      results.push({
        overrideId: o.id,
        url,
        kind: 'expose',
        status: r.status,
        message: r.message,
        label: `globalThis.${o.expose.name}`
      })
    }

    for (const o of entries.filter((e) => e.kind === 'watch')) {
      if (!o.watch) continue
      const r = applyWatch(text, o.watch)
      text = r.text
      results.push({
        overrideId: o.id,
        url,
        kind: 'watch',
        status: r.status,
        message: r.message,
        label: `observando ${o.watch.label}`
      })
    }

    // O mapa vai por último: instrumenta o resultado final, já com as edições
    // e observações do dev aplicadas.
    for (const o of entries.filter((e) => e.kind === 'map')) {
      /**
       * Determinístico a partir do conteúdo: o mesmo arquivo buscado de novo
       * (um `fetch` da própria página, por exemplo) reinstrumenta e precisa
       * cair no mesmo id, senão as contagens vivas ficariam órfãs. Se o
       * arquivo mudar no servidor, o id muda junto — que é o desejado.
       */
      const fileId = sha256(`${url}\n${text}`).slice(0, 8)
      const r = applyExecutionMap(text, fileId)
      text = r.text
      if (r.status === 'applied') catalog = { fileId, functions: r.catalog }
      results.push({
        overrideId: o.id,
        url,
        kind: 'map',
        status: r.status,
        message: r.message,
        label: `mapa de execução (${r.catalog.length} funções)`
      })
    }

    return { text, results, catalog }
  }
}
