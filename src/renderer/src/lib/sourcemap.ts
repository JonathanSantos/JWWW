import {
  GREATEST_LOWER_BOUND,
  LEAST_UPPER_BOUND,
  TraceMap,
  generatedPositionFor,
  originalPositionFor
} from '@jridgewell/trace-mapping'
import {
  SourceMapSchema,
  decodeDataUrl,
  findSourceMappingURL,
  isDataUrl,
  offsetToPosition,
  positionToOffset,
  resolveSourceMapURL,
  resolveSourceURL,
  sourceLabel,
  type RawSourceMap
} from '@shared/sourcemap'

export type LoadedSourceMap = {
  /** URL do arquivo gerado a que este mapa pertence */
  resourceUrl: string
  mapUrl: string
  raw: RawSourceMap
  trace: TraceMap
  /** conteúdo de cada source, resolvido (embutido ou buscado) */
  contents: Array<{ source: string; label: string; text: string | null }>
}

const cache = new Map<string, LoadedSourceMap | null>()

async function fetchText(url: string): Promise<string | null> {
  const res = await window.api.net.fetchText(url)
  return res.ok && res.text !== undefined ? res.text : null
}

/**
 * Carrega o source map de um arquivo já baixado. `body` é o texto do bundle,
 * de onde sai o comentário `//# sourceMappingURL=`.
 */
export async function loadSourceMap(resourceUrl: string, body: string): Promise<LoadedSourceMap | null> {
  if (cache.has(resourceUrl)) return cache.get(resourceUrl)!

  const carregado = await carregar(resourceUrl, body)
  cache.set(resourceUrl, carregado)
  return carregado
}

async function carregar(resourceUrl: string, body: string): Promise<LoadedSourceMap | null> {
  const referencia = findSourceMappingURL(body)
  if (!referencia) return null

  const mapUrl = resolveSourceMapURL(referencia, resourceUrl)
  if (!mapUrl) return null

  const bruto = isDataUrl(mapUrl) ? decodeDataUrl(mapUrl) : await fetchText(mapUrl)
  if (!bruto) return null

  let raw: RawSourceMap
  try {
    // Alguns servidores prefixam com `)]}'` para impedir hijacking de JSON.
    const limpo = bruto.replace(/^\)\]\}'?[^\n]*\n/, '')
    raw = SourceMapSchema.parse(JSON.parse(limpo))
  } catch {
    return null
  }

  const trace = new TraceMap(raw as never)
  const contents = await Promise.all(
    raw.sources.map(async (source, i) => {
      const embutido = raw.sourcesContent?.[i] ?? null
      let text = embutido
      if (text === null && source) {
        const url = resolveSourceURL(source, raw, mapUrl)
        if (url) text = await fetchText(url)
      }
      return { source: source ?? `(source ${i})`, label: sourceLabel(source), text }
    })
  )

  return { resourceUrl, mapUrl, raw, trace, contents }
}

export function forgetSourceMap(resourceUrl: string): void {
  cache.delete(resourceUrl)
}

/**
 * Traduz um offset do fonte original para o offset correspondente no bundle.
 * Devolve null quando aquela posição não tem correspondência (comum em código
 * que sumiu no build: tipos, comentários, ramos eliminados).
 */
export function originalOffsetToGenerated(
  map: LoadedSourceMap,
  sourceIndex: number,
  sourceText: string,
  offset: number,
  generatedText: string
): number | null {
  const source = map.raw.sources[sourceIndex]
  if (!source) return null
  const pos = offsetToPosition(sourceText, offset)

  /**
   * O dev seleciona a partir do começo do trecho, que costuma cair em
   * indentação ou numa palavra que sumiu no build (`export`, `declare`). Nesses
   * pontos não há mapeamento: procuramos o primeiro token mapeado a partir dali
   * antes de desistir.
   */
  for (const bias of [LEAST_UPPER_BOUND, GREATEST_LOWER_BOUND] as const) {
    const gerada = generatedPositionFor(map.trace, {
      source,
      line: pos.line,
      column: pos.column,
      bias
    })
    if (gerada.line !== null && gerada.column !== null) {
      return positionToOffset(generatedText, gerada.line, gerada.column)
    }
  }

  /**
   * De propósito não procuramos nas linhas seguintes: selecionar um tipo e
   * acabar instrumentando a função de baixo seria pior do que avisar que aquele
   * ponto não existe no bundle.
   */
  return null
}

/** Caminho inverso: onde no fonte original está este ponto do bundle. */
export function generatedOffsetToOriginal(
  map: LoadedSourceMap,
  generatedText: string,
  offset: number
): { sourceIndex: number; offset: number } | null {
  const pos = offsetToPosition(generatedText, offset)
  const original = originalPositionFor(map.trace, { line: pos.line, column: pos.column })
  if (original.source === null || original.line === null) return null
  const sourceIndex = map.raw.sources.indexOf(original.source)
  if (sourceIndex === -1) return null
  const texto = map.contents[sourceIndex]?.text
  if (!texto) return null
  return { sourceIndex, offset: positionToOffset(texto, original.line, original.column ?? 0) }
}

export function languageFromSource(source: string): string {
  if (/\.tsx?$/.test(source)) return 'typescript'
  if (/\.jsx$/.test(source)) return 'javascript'
  if (/\.vue$/.test(source)) return 'html'
  if (/\.css$/.test(source)) return 'css'
  return 'javascript'
}
