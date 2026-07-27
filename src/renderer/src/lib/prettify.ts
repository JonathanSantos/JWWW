import { css as beautifyCss, html as beautifyHtml, js as beautifyJs } from 'js-beautify'
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from 'diff-match-patch'

const dmp = new diff_match_patch()

const OPTS = { indent_size: 2, preserve_newlines: false, end_with_newline: true } as const

export function canPrettify(language: string): boolean {
  return language === 'javascript' || language === 'css' || language === 'html' || language === 'json'
}

export function prettify(text: string, language: string): string {
  switch (language) {
    case 'css':
      return beautifyCss(text, OPTS)
    case 'html':
      return beautifyHtml(text, { ...OPTS, wrap_line_length: 0 })
    case 'json':
      try {
        return JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        return beautifyJs(text, OPTS)
      }
    default:
      return beautifyJs(text, OPTS)
  }
}

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

/**
 * O beautify só mexe em espaço em branco: a sequência de caracteres não-brancos
 * é idêntica nos dois textos. Isso permite mapear qualquer posição do texto
 * formatado de volta para o original — e é o que mantém o override intacto:
 * o que vai para o servidor continua sendo o arquivo original + suas edições,
 * nunca o arquivo inteiro reformatado.
 *
 * Devolve null se a premissa não valer (aí a formatação vira só leitura).
 */
export function buildOffsetMap(original: string, pretty: string): Int32Array | null {
  const map = new Int32Array(pretty.length + 1)
  let o = 0
  for (let p = 0; p < pretty.length; p++) {
    const pc = pretty[p]
    if (isWs(pc)) {
      map[p] = o
      continue
    }
    while (o < original.length && isWs(original[o])) o++
    if (o >= original.length || original[o] !== pc) return null
    map[p] = o
    o++
  }
  while (o < original.length && isWs(original[o])) o++
  if (o !== original.length) return null
  map[pretty.length] = original.length
  return map
}

export type PrettyAnchor = {
  /** texto original (espaço em branco preservado) no momento em que formatou */
  base: string
  /** resultado do beautify sobre `base` */
  prettyBase: string
  /** prettyBase index -> base index; null quando o mapeamento não é confiável */
  map: Int32Array | null
}

export function makeAnchor(base: string, language: string): PrettyAnchor {
  const prettyBase = prettify(base, language)
  return { base, prettyBase, map: buildOffsetMap(base, prettyBase) }
}

/** Converte um intervalo do texto formatado para o intervalo equivalente no original. */
export function mapRange(anchor: PrettyAnchor, start: number, end: number): [number, number] | null {
  const { map } = anchor
  if (!map) return null
  const s = Math.max(0, Math.min(start, map.length - 1))
  const e = Math.max(0, Math.min(end, map.length - 1))
  return [map[s], map[e]]
}

/**
 * Pega as edições feitas sobre o texto formatado e reaplica no texto original,
 * preservando toda a formatação original que o dev não tocou.
 */
export function applyPrettyEdits(anchor: PrettyAnchor, prettyEdited: string): string | null {
  const { prettyBase, base, map } = anchor
  if (!map) return null
  if (prettyEdited === prettyBase) return base

  const diffs = dmp.diff_main(prettyBase, prettyEdited)
  dmp.diff_cleanupSemantic(diffs)

  // Reconstrói do fim para o começo para não invalidar os offsets já mapeados.
  const ops: Array<{ start: number; end: number; text: string }> = []
  let p = 0
  for (const [op, data] of diffs) {
    if (op === DIFF_INSERT) {
      const at = map[Math.min(p, map.length - 1)]
      ops.push({ start: at, end: at, text: data })
    } else if (op === DIFF_DELETE) {
      const from = map[Math.min(p, map.length - 1)]
      const to = map[Math.min(p + data.length, map.length - 1)]
      ops.push({ start: from, end: to, text: '' })
      p += data.length
    } else {
      p += data.length
    }
  }

  let out = base
  for (const op of ops.reverse()) {
    if (op.start > op.end || op.end > out.length) return null
    out = out.slice(0, op.start) + op.text + out.slice(op.end)
  }
  return out
}
