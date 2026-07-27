import { z } from 'zod'

/**
 * Descoberta e leitura de source maps.
 *
 * Escopo deliberado: o source map serve para **ler e localizar** — mostrar o
 * fonte original e traduzir uma seleção dele para o intervalo correspondente no
 * bundle. O override continua ancorado no bundle, exatamente como antes, porque
 * é ele que o servidor entrega. Não tentamos reescrever o fonte original e
 * regerar o bundle: isso exigiria rodar o build do site (tsconfig, plugins,
 * minificador), que não temos.
 */

export const SourceMapSchema = z.object({
  version: z.number(),
  sources: z.array(z.string().nullable()),
  sourcesContent: z.array(z.string().nullable()).optional(),
  names: z.array(z.string()).optional(),
  mappings: z.string(),
  file: z.string().optional(),
  sourceRoot: z.string().optional()
})
export type RawSourceMap = z.infer<typeof SourceMapSchema>

const COMMENT_RE = /[#@]\s*sourceMappingURL\s*=\s*(\S+)[\s]*$/

/**
 * Procura o `//# sourceMappingURL=` no fim do arquivo. Só as últimas linhas
 * interessam: uma ocorrência no meio do código costuma ser texto dentro de uma
 * string (um bundler embutindo outro arquivo, por exemplo).
 */
export function findSourceMappingURL(body: string): string | null {
  const tail = body.slice(-2048)
  const linhas = tail.split('\n')
  for (let i = linhas.length - 1; i >= 0; i--) {
    const linha = linhas[i].trim()
    if (!linha.startsWith('//') && !linha.startsWith('/*')) continue
    const m = linha.replace(/\*\/\s*$/, '').match(COMMENT_RE)
    if (m) return m[1]
  }
  return null
}

export function isDataUrl(url: string): boolean {
  return url.startsWith('data:')
}

/** Decodifica um source map embutido como data: URI. */
export function decodeDataUrl(url: string): string | null {
  const virgula = url.indexOf(',')
  if (virgula === -1) return null
  const meta = url.slice(0, virgula)
  const dados = url.slice(virgula + 1)
  try {
    if (meta.includes(';base64')) {
      const bin = atob(dados)
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      return new TextDecoder('utf-8').decode(bytes)
    }
    return decodeURIComponent(dados)
  } catch {
    return null
  }
}

export function resolveSourceMapURL(mappingUrl: string, resourceUrl: string): string | null {
  if (isDataUrl(mappingUrl)) return mappingUrl
  try {
    return new URL(mappingUrl, resourceUrl).toString()
  } catch {
    return null
  }
}

/** URL absoluta de um `sources[i]`, para buscar o fonte quando não vem embutido. */
export function resolveSourceURL(source: string, map: RawSourceMap, mapUrl: string): string | null {
  const comRoot = map.sourceRoot ? `${map.sourceRoot.replace(/\/?$/, '/')}${source}` : source
  try {
    return new URL(comRoot, isDataUrl(mapUrl) ? undefined : mapUrl).toString()
  } catch {
    return null
  }
}

/** Rótulo curto de um source: `src/app.ts` em vez do caminho inteiro. */
export function sourceLabel(source: string | null): string {
  if (!source) return '(sem nome)'
  const limpo = source.replace(/^webpack:\/\/\//, '').replace(/^\.\//, '')
  const partes = limpo.split('/')
  return partes.slice(-2).join('/') || limpo
}

/** offset absoluto -> {line, column} em base 1/0, como o source map espera. */
export function offsetToPosition(text: string, offset: number): { line: number; column: number } {
  const limite = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let ultimaQuebra = -1
  for (let i = 0; i < limite; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      ultimaQuebra = i
    }
  }
  return { line, column: limite - ultimaQuebra - 1 }
}

/** {line, column} -> offset absoluto. */
export function positionToOffset(text: string, line: number, column: number): number {
  let offset = 0
  let atual = 1
  while (atual < line) {
    const proxima = text.indexOf('\n', offset)
    if (proxima === -1) return text.length
    offset = proxima + 1
    atual++
  }
  return Math.min(offset + column, text.length)
}
