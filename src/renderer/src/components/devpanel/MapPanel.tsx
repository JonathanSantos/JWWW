import { useEffect, useMemo, useState } from 'react'
import { Crosshair, FileCode2, Radar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { fileLabel } from '@/lib/lang'
import { loadSourceMapFromUrl, originalNameAt, type LoadedSourceMap } from '@/lib/sourcemap'
import { openOverrideInEditor } from '@/lib/editor'
import type { MapFunction } from '@shared/types'

type Linha = {
  fn: MapFunction
  calls: number
  ms: number
  ordem: number
  /** nome resolvido pelo source map, quando disponível */
  nome: string
  local: string | null
}

type Ordenacao = 'chamadas' | 'tempo' | 'primeira'

const ORDENACOES: Array<{ valor: Ordenacao; rotulo: string }> = [
  { valor: 'chamadas', rotulo: 'mais chamadas' },
  { valor: 'tempo', rotulo: 'mais tempo' },
  { valor: 'primeira', rotulo: 'ordem de execução' }
]

function formatarMs(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 1000)}µs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function MapPanel() {
  const catalogos = useApp((s) => s.mapCatalogs)
  const contagens = useApp((s) => s.mapCounts)
  const limpar = useApp((s) => s.clearMapCounts)
  const overrides = useApp((s) => s.overrides)

  const fileIds = Object.keys(catalogos)
  const [fileIdAtivo, setFileIdAtivo] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('chamadas')
  const [mostrarNaoExecutadas, setMostrarNaoExecutadas] = useState(false)
  const [sourceMap, setSourceMap] = useState<LoadedSourceMap | null>(null)

  const fileId = fileIdAtivo && catalogos[fileIdAtivo] ? fileIdAtivo : (fileIds[0] ?? null)
  const catalogo = fileId ? catalogos[fileId] : null
  const url = catalogo?.url ?? null

  // Nomes minificados viram nomes reais quando o site publica source map.
  useEffect(() => {
    setSourceMap(null)
    if (!catalogo?.sourceMappingUrl) return
    let cancelado = false
    loadSourceMapFromUrl(catalogo.url, catalogo.sourceMappingUrl).then((m) => {
      if (!cancelado) setSourceMap(m)
    })
    return () => {
      cancelado = true
    }
  }, [catalogo?.url, catalogo?.sourceMappingUrl])

  const { linhas, totalExecutadas, maiorChamadas } = useMemo(() => {
    if (!catalogo || !fileId) return { linhas: [] as Linha[], totalExecutadas: 0, maiorChamadas: 0 }
    const cont = contagens[fileId] ?? {}

    const todas: Linha[] = catalogo.functions.map((fn) => {
      const c = cont[fn.id]
      const original = sourceMap ? originalNameAt(sourceMap, fn.nameLine, fn.nameColumn) : null
      return {
        fn,
        calls: c?.calls ?? 0,
        ms: c?.ms ?? 0,
        ordem: c?.ordem ?? Number.MAX_SAFE_INTEGER,
        nome: original?.name || fn.name || '(anônima)',
        local: original ? `${original.file}:${original.line}` : `linha ${fn.line}`
      }
    })

    const executadas = todas.filter((l) => l.calls > 0)
    const base = mostrarNaoExecutadas ? todas : executadas
    const filtradas = filtro
      ? base.filter(
          (l) =>
            l.nome.toLowerCase().includes(filtro.toLowerCase()) ||
            (l.local ?? '').toLowerCase().includes(filtro.toLowerCase())
        )
      : base

    const ordenadas = [...filtradas].sort((a, b) => {
      if (ordenacao === 'tempo') return b.ms - a.ms || b.calls - a.calls
      if (ordenacao === 'primeira') return a.ordem - b.ordem
      return b.calls - a.calls || b.ms - a.ms
    })

    return {
      linhas: ordenadas,
      totalExecutadas: executadas.length,
      maiorChamadas: executadas.reduce((max, l) => Math.max(max, l.calls), 0)
    }
  }, [catalogo, contagens, fileId, filtro, ordenacao, mostrarNaoExecutadas, sourceMap])

  if (!catalogo || !fileId || !url) {
    const temOverride = overrides.some((o) => o.kind === 'map' && o.enabled)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <Radar className="h-6 w-6 opacity-40" />
        <p className="text-sm font-medium text-foreground/80">Mapa de execução</p>
        {temOverride ? (
          <p>Arquivo instrumentado — recarregue a página (⌘R) para o mapa começar a preencher.</p>
        ) : (
          <>
            <p>
              Abra um arquivo JS no <span className="font-semibold">Editor</span> e clique em{' '}
              <span className="font-semibold">Mapear</span>.
            </p>
            <p>
              Todas as funções do arquivo passam a ser contadas: você descobre o que de fato executa num
              bundle que não conhece, e o que nunca roda.
            </p>
          </>
        )}
      </div>
    )
  }

  const percentual = catalogo.functions.length
    ? Math.round((totalExecutadas / catalogo.functions.length) * 100)
    : 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        {fileIds.length > 1 ? (
          <select
            value={fileId}
            onChange={(e) => setFileIdAtivo(e.target.value)}
            className="h-7 w-full rounded-md border-none bg-secondary/60 px-2 font-mono text-[11px] outline-none"
          >
            {fileIds.map((id) => (
              <option key={id} value={id}>
                {fileLabel(catalogos[id].url)}
              </option>
            ))}
          </select>
        ) : (
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={url}>
            {fileLabel(url)}
          </div>
        )}

        {/* o número que importa: quanto do bundle realmente interessa */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold tabular-nums text-foreground">{totalExecutadas}</span>
          <span className="text-xs text-muted-foreground">
            de {catalogo.functions.length} funções executaram
          </span>
          <Badge variant="outline" className="h-4 border-emerald-500/50 px-1.5 text-[9px] text-emerald-400">
            {percentual}%
          </Badge>
          {sourceMap && (
            <Badge variant="outline" className="h-4 border-sky-500/50 px-1.5 text-[9px] text-sky-400">
              nomes originais
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por nome ou arquivo…"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 select-text rounded-md bg-secondary/60 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:bg-secondary"
          />
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            className="h-7 rounded-md border-none bg-secondary/60 px-2 text-[11px] outline-none"
          >
            {ORDENACOES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>

        {/* o fluxo mais útil do painel */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-[11px]"
            onClick={() => limpar(fileId)}
            title="Zere, interaja com a página e veja só o que aquela ação disparou"
          >
            <Crosshair className="mr-1 h-3 w-3" /> Zerar contadores
          </Button>
          <span className="text-[10px] text-muted-foreground">
            zere → interaja com o site → veja o que aquilo disparou
          </span>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={mostrarNaoExecutadas}
            onChange={(e) => setMostrarNaoExecutadas(e.target.checked)}
            className="h-3 w-3 accent-current"
          />
          incluir as que nunca rodaram
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {linhas.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {totalExecutadas === 0
              ? 'Nada executou ainda — recarregue a página ou interaja com o site.'
              : 'Nenhuma função corresponde ao filtro.'}
          </p>
        )}
        {linhas.map((l) => {
          const proporcao = maiorChamadas > 0 ? l.calls / maiorChamadas : 0
          return (
            <div
              key={l.fn.id}
              onClick={() => {
                const override = overrides.find((o) => o.kind === 'map' && o.url === url)
                if (override) openOverrideInEditor({ ...override, kind: 'edit' })
              }}
              title={`${l.fn.nodeType} · offset ${l.fn.start}`}
              className={cn(
                'group relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-xs hover:bg-secondary/40',
                l.calls === 0 && 'opacity-40'
              )}
            >
              {/* barra proporcional: dá para ranquear no olho, sem ler números */}
              <div
                className="absolute inset-y-0 left-0 bg-sky-500/10"
                style={{ width: `${Math.max(proporcao * 100, l.calls > 0 ? 2 : 0)}%` }}
              />
              <FileCode2 className="relative h-3 w-3 shrink-0 text-muted-foreground/60" />
              <span className="relative min-w-0 flex-1 truncate font-mono">{l.nome}</span>
              <span className="relative shrink-0 font-mono text-[10px] text-muted-foreground">{l.local}</span>
              <span className="relative w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                {l.ms > 0 ? formatarMs(l.ms) : '—'}
              </span>
              <span
                className={cn(
                  'relative w-12 shrink-0 text-right font-medium tabular-nums',
                  l.calls > 0 ? 'text-sky-300' : 'text-muted-foreground'
                )}
              >
                {l.calls > 0 ? l.calls.toLocaleString('pt-BR') : '0'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
