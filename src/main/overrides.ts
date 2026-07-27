import { createHash } from 'crypto'
import { diff_match_patch } from 'diff-match-patch'
import * as acorn from 'acorn'
import type { OverrideEntry } from '@shared/schemas'
import type { OverrideStatus } from '@shared/types'
import { overrideMatches } from '@shared/glob'

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
  kind: 'edit' | 'expose'
  status: OverrideStatus
  message?: string
  label?: string
}

const PARSE_OPTS: acorn.Options = {
  ecmaVersion: 'latest',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true
}

function parsesAsFile(text: string): boolean {
  try {
    acorn.parse(text, { ...PARSE_OPTS, sourceType: 'script' })
    return true
  } catch {
    try {
      acorn.parse(text, { ...PARSE_OPTS, sourceType: 'module' })
      return true
    } catch {
      return false
    }
  }
}

function isExpression(sel: string): boolean {
  try {
    const prog = acorn.parse(`(${sel}\n)`, PARSE_OPTS) as unknown as { body: Array<{ type: string }> }
    return prog.body.length === 1 && prog.body[0].type === 'ExpressionStatement'
  } catch {
    return false
  }
}

function declarationNames(sel: string): string[] {
  let prog: any
  try {
    prog = acorn.parse(sel, { ...PARSE_OPTS, sourceType: 'script' })
  } catch {
    try {
      prog = acorn.parse(sel, { ...PARSE_OPTS, sourceType: 'module' })
    } catch {
      return []
    }
  }
  if (!prog?.body || prog.body.length !== 1) return []
  const node = prog.body[0]
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id?.name) {
    return [node.id.name]
  }
  if (node.type === 'VariableDeclaration') {
    const names: string[] = []
    for (const d of node.declarations) {
      if (d.id?.type === 'Identifier') names.push(d.id.name)
    }
    return names
  }
  return []
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

  if (isExpression(selection)) {
    const replacement = `(globalThis[${nameLit}] = (${selection}\n))`
    transformed = body.slice(0, pos) + replacement + body.slice(pos + selection.length)
  } else {
    const names = declarationNames(selection)
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
  if (parsesAsFile(body) && !parsesAsFile(transformed)) {
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
  constructor(private getAll: () => OverrideEntry[]) {}

  enabledFor(url: string): OverrideEntry[] {
    const key = stripHash(url)
    return this.getAll().filter((o) => o.enabled && overrideMatches(o, key))
  }

  hasAny(): boolean {
    return this.getAll().some((o) => o.enabled)
  }

  apply(url: string, body: string): { text: string; results: ApplyResult[] } {
    const entries = this.enabledFor(url)
    const results: ApplyResult[] = []
    let text = body

    for (const o of entries.filter((e) => e.kind === 'edit')) {
      if (o.editedText === undefined) continue
      const base = { overrideId: o.id, url, kind: 'edit' as const, label: fileLabel(url) }
      if (sha256(text) === o.originalHash) {
        text = o.editedText
        results.push({ ...base, status: 'applied' })
        continue
      }
      const patches = dmp.patch_make(o.originalText, o.editedText)
      const [patched, oks] = dmp.patch_apply(patches, text) as [string, boolean[]]
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

    return { text, results }
  }
}
