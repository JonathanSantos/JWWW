import { useEffect, useState } from 'react'
import { Ban, ShieldOff, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useActiveTab, useApp } from '@/store/app'
import { fileLabel, formatBytes, hostOf, isTextual } from '@/lib/lang'
import { openResourceInEditor } from '@/lib/editor'
import type { ThrottlePreset } from '@shared/types'

function statusColor(status?: number, blocked?: boolean, error?: string) {
  if (blocked) return 'text-red-400'
  if (error) return 'text-red-400'
  if (!status) return 'text-muted-foreground'
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-orange-400'
  if (status >= 300) return 'text-sky-400'
  return 'text-emerald-400'
}

const EMPTY: never[] = []

/** Renderizar centenas de linhas de uma vez engasga a UI num site movimentado. */
const LIMITE_VISIVEL = 300

export function NetworkPanel() {
  const active = useActiveTab()
  const entries = useApp((s) => (active ? s.net[active.id] : undefined)) ?? EMPTY
  const rules = useApp((s) => s.rules)
  const [query, setQuery] = useState('')
  const [newRule, setNewRule] = useState('')
  const [throttle, setThrottle] = useState<ThrottlePreset>('none')
  const [noCsp, setNoCsp] = useState(false)

  useEffect(() => {
    window.api.net.getDisableCsp().then(setNoCsp)
  }, [])

  const todas = entries.filter((e) => !query || e.url.toLowerCase().includes(query.toLowerCase()))
  // As mais recentes são as que interessam, então o corte é no começo da lista.
  const filtered = todas.slice(-LIMITE_VISIVEL)

  const addRule = (pattern: string) => {
    const p = pattern.trim()
    if (!p) return
    window.api.rules.save({ id: crypto.randomUUID(), pattern: p, action: 'block', enabled: true })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar requisições…"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 select-text rounded-md bg-secondary/60 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:bg-secondary"
          />
          <select
            value={throttle}
            onChange={(e) => {
              const preset = e.target.value as ThrottlePreset
              setThrottle(preset)
              if (active) window.api.net.throttle(active.id, preset)
            }}
            className="h-7 rounded-md border-none bg-secondary/60 px-2 text-xs outline-none"
            title="Throttling de rede"
          >
            <option value="none">Sem throttle</option>
            <option value="fast3g">Fast 3G</option>
            <option value="slow3g">Slow 3G</option>
            <option value="offline">Offline</option>
          </select>
          <Button
            variant={noCsp ? 'secondary' : 'ghost'}
            size="icon"
            className={cn('h-7 w-7', noCsp && 'text-amber-400')}
            title="Desabilitar CSP nesta sessão (permite injetar UI e scripts em sites restritivos)"
            onClick={async () => {
              const next = !noCsp
              await window.api.net.setDisableCsp(next)
              setNoCsp(next)
              toast[next ? 'warning' : 'success'](
                next ? 'CSP desabilitado nesta sessão' : 'CSP reativado',
                { description: next ? 'Recarregue a página. Volta ao normal ao reiniciar o app.' : undefined }
              )
            }}
          >
            <ShieldOff className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Limpar log"
            onClick={() => active && window.api.net.clear(active.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              addRule(newRule)
              setNewRule('')
            }}
          >
            <input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="Bloquear padrão (ex: *analytics*)…"
              spellCheck={false}
              className="h-6 w-52 select-text rounded-md bg-secondary/40 px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:bg-secondary"
            />
          </form>
          {rules.map((r) => (
            <span
              key={r.id}
              className={cn(
                'flex items-center gap-1.5 rounded-full bg-secondary/70 py-0.5 pl-2 pr-1 font-mono text-[10px]',
                !r.enabled && 'opacity-50'
              )}
            >
              <Ban className="h-2.5 w-2.5 text-red-400" />
              {r.pattern}
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => window.api.rules.save({ ...r, enabled: v })}
                className="h-3.5 w-6 [&_span]:h-3 [&_span]:w-3 data-[state=checked]:[&_span]:translate-x-2.5"
              />
              <button onClick={() => window.api.rules.remove(r.id)} className="rounded p-0.5 hover:bg-muted">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
        {filtered.length === 0 && (
          <p className="p-4 text-center font-sans text-xs text-muted-foreground">
            Nenhuma requisição capturada.
          </p>
        )}
        {todas.length > filtered.length && (
          <div className="px-2 py-1 font-sans text-[10px] text-muted-foreground">
            mostrando as {filtered.length} mais recentes de {todas.length} — use o filtro para as demais
          </div>
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            onClick={() => isTextual(e) && openResourceInEditor(e)}
            title={e.url}
            className={cn(
              'group flex items-center gap-2 border-b border-border/40 px-2 py-[3px]',
              isTextual(e) && 'cursor-pointer hover:bg-secondary/50',
              e.blocked && 'opacity-60'
            )}
          >
            <span className={cn('w-8 shrink-0 tabular-nums', statusColor(e.status, e.blocked, e.error))}>
              {e.blocked ? 'BLK' : (e.status ?? '…')}
            </span>
            <span className="w-10 shrink-0 text-muted-foreground">{e.method}</span>
            <span className={cn('min-w-0 flex-1 truncate', e.blocked && 'line-through')}>
              {fileLabel(e.url)}
              <span className="ml-1.5 text-muted-foreground/60">{hostOf(e.url)}</span>
            </span>
            {e.overridden && (
              <Badge variant="outline" className="h-4 shrink-0 border-amber-500/50 px-1 text-[9px] text-amber-400">
                override
              </Badge>
            )}
            <span className="w-16 shrink-0 text-right text-muted-foreground">{e.resourceType}</span>
            <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
              {formatBytes(e.encodedLength)}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
              {e.endTime ? `${e.endTime - e.startTime}ms` : '…'}
            </span>
            <button
              title="Bloquear este host"
              onClick={(ev) => {
                ev.stopPropagation()
                addRule(hostOf(e.url))
              }}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-70"
            >
              <Ban className="h-3 w-3 text-red-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
