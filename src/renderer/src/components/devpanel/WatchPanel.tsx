import { useState } from 'react'
import { ChevronDown, ChevronRight, Eye, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { hostOf } from '@/lib/lang'
import type { WatchEvent } from '@shared/types'

function Valor({ v }: { v: unknown }) {
  if (v === undefined) return <span className="text-muted-foreground">—</span>
  if (typeof v === 'string') return <span className="text-emerald-300">{v}</span>
  return (
    <span className="whitespace-pre-wrap break-all">
      {JSON.stringify(v, null, 1)?.replace(/\n\s*/g, ' ') ?? String(v)}
    </span>
  )
}

function Evento({ ev }: { ev: WatchEvent }) {
  const [aberto, setAberto] = useState(false)
  const temDetalhe = Boolean(ev.stack) || ev.args !== undefined

  return (
    <div className="mb-1 rounded-md bg-secondary/40 px-2 py-1.5">
      <div
        className={cn('flex items-center gap-1.5', temDetalhe && 'cursor-pointer')}
        onClick={() => temDetalhe && setAberto((a) => !a)}
      >
        {temDetalhe ? (
          aberto ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Badge
          variant="outline"
          className={cn(
            'h-4 shrink-0 px-1.5 font-mono text-[9px]',
            ev.error ? 'border-red-500/50 text-red-400' : 'border-sky-500/50 text-sky-400'
          )}
        >
          {ev.label}
        </Badge>
        {ev.async && (
          <Badge variant="outline" className="h-4 shrink-0 border-violet-500/50 px-1 text-[9px] text-violet-400">
            async
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
          {ev.error ? (
            <span className="text-red-400">
              lançou <Valor v={ev.error} />
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">→ </span>
              <Valor v={ev.result} />
            </>
          )}
        </span>
        {ev.ms !== undefined && (
          <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground">{ev.ms.toFixed(1)}ms</span>
        )}
        <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
          {new Date(ev.at).toLocaleTimeString()}
        </span>
      </div>

      {aberto && (
        <div className="mt-1.5 space-y-1 pl-4">
          {ev.args !== undefined && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">argumentos</div>
              <pre className="select-text whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/90">
                {JSON.stringify(ev.args, null, 1)}
              </pre>
            </div>
          )}
          {ev.stack && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">chamado por</div>
              <pre className="select-text whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                {ev.stack}
              </pre>
            </div>
          )}
          <div className="font-mono text-[9px] text-muted-foreground/70">{hostOf(ev.url)}</div>
        </div>
      )}
    </div>
  )
}

export function WatchPanel() {
  const eventos = useApp((s) => s.watchLog)
  const limpar = useApp((s) => s.clearWatchLog)
  const overrides = useApp((s) => s.overrides)
  const [filtro, setFiltro] = useState('')

  const observados = overrides.filter((o) => o.kind === 'watch')
  const visiveis = filtro
    ? eventos.filter((e) => e.label.toLowerCase().includes(filtro.toLowerCase()))
    : eventos

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <div className="flex items-center gap-1.5">
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por rótulo…"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 select-text rounded-md bg-secondary/60 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:bg-secondary"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Limpar log" onClick={limpar}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {observados.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Selecione uma função ou expressão no <span className="font-semibold">Editor</span> e use{' '}
            <span className="font-semibold">Observar</span>. A cada execução, o argumento, o retorno e o tempo
            aparecem aqui.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {observados.map((o) => (
              <span
                key={o.id}
                className={cn(
                  'flex items-center gap-1.5 rounded-full bg-secondary/70 py-0.5 pl-2 pr-1 font-mono text-[10px]',
                  !o.enabled && 'opacity-50'
                )}
                title={o.url}
              >
                <Eye className="h-2.5 w-2.5 text-sky-400" />
                {o.watch?.label}
                <Switch
                  checked={o.enabled}
                  onCheckedChange={(v) => window.api.overrides.save({ ...o, enabled: v })}
                  className="h-3.5 w-6 [&_span]:h-3 [&_span]:w-3 data-[state=checked]:[&_span]:translate-x-2.5"
                />
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {visiveis.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {observados.length === 0
              ? 'Nada sendo observado ainda.'
              : 'Nenhuma execução registrada — recarregue a página e interaja com o site.'}
          </p>
        )}
        {[...visiveis].reverse().map((ev, i) => (
          <Evento key={`${ev.at}-${i}`} ev={ev} />
        ))}
      </div>
    </div>
  )
}
