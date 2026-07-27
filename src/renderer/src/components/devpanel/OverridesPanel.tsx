import { useState } from 'react'
import { FileCode2, Globe2, Pencil, Regex, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { fileLabel, hostOf } from '@/lib/lang'
import { openOverrideInEditor } from '@/lib/editor'
import { globMatch, suggestPattern } from '@shared/glob'
import type { OverrideEntry } from '@shared/schemas'

function PatternDialog({ entry, onClose }: { entry: OverrideEntry; onClose: () => void }) {
  const [value, setValue] = useState(entry.pattern ?? suggestPattern(entry.url) ?? entry.url)
  const valid = value.trim().length > 0
  const matchesOrigin = valid && globMatch(value.trim(), entry.url)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Padrão de URL do override</DialogTitle>
          <DialogDescription>
            Use <code className="font-mono text-violet-400">*</code> para casar qualquer trecho. Serve para
            bundles com hash no nome, que mudam a cada deploy. Deixe vazio para voltar a casar só a URL exata.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            className="select-text font-mono text-xs"
            autoFocus
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            URL de origem: <span className="select-text">{entry.url}</span>
          </p>
          {valid && (
            <p className={cn('text-[11px]', matchesOrigin ? 'text-emerald-400' : 'text-amber-400')}>
              {matchesOrigin
                ? '✓ o padrão casa com a URL de origem'
                : '⚠ o padrão não casa com a URL de origem — confira antes de salvar'}
            </p>
          )}
        </div>
        <DialogFooter>
          {entry.pattern && (
            <Button
              variant="ghost"
              className="mr-auto text-xs"
              onClick={() => {
                const { pattern: _drop, ...rest } = entry
                window.api.overrides.save(rest)
                toast.success('Voltou a casar por URL exata')
                onClose()
              }}
            >
              Remover padrão
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              window.api.overrides.save({ ...entry, pattern: value.trim() })
              toast.success('Padrão salvo', { description: value.trim() })
              onClose()
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function OverridesPanel() {
  const overrides = useApp((s) => s.overrides)
  const statuses = useApp((s) => s.statuses)
  const [editingPattern, setEditingPattern] = useState<OverrideEntry | null>(null)

  if (overrides.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <p className="text-sm font-medium text-foreground/80">Nenhum override</p>
        <p>
          Abra um arquivo no <span className="font-semibold">Editor</span>, edite e salve (⌘S) — ou selecione um
          trecho de JS e use <span className="font-semibold">Expor global</span>.
        </p>
        <p>
          Overrides são patches aplicados sobre o arquivo que o servidor entrega a cada reload. Se o site mudar e o
          patch não aplicar, o original é servido e você é avisado.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      {overrides.map((o) => {
        const last = [...statuses].reverse().find((st) => st.overrideId === o.id)
        return (
          <div
            key={o.id}
            className={cn(
              'mb-1.5 flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-2',
              !o.enabled && 'opacity-50'
            )}
          >
            {o.kind === 'edit' ? (
              <FileCode2 className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Globe2 className="h-4 w-4 shrink-0 text-violet-400" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-mono text-xs">{fileLabel(o.url)}</span>
                {o.kind === 'expose' && (
                  <Badge variant="outline" className="h-4 shrink-0 border-violet-500/50 px-1 text-[9px] text-violet-400">
                    globalThis.{o.expose?.name}
                  </Badge>
                )}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {o.pattern ? o.pattern : hostOf(o.url)}
              </div>
            </div>
            {o.pattern && (
              <Badge
                variant="outline"
                className="h-4 shrink-0 border-sky-500/50 px-1 text-[9px] text-sky-400"
                title={`Casa por padrão: ${o.pattern}`}
              >
                glob
              </Badge>
            )}
            {last && (
              <Badge
                variant="outline"
                title={last.message}
                className={cn(
                  'h-4 shrink-0 px-1.5 text-[9px]',
                  last.status === 'applied' && 'border-emerald-500/50 text-emerald-400',
                  last.status === 'fuzzy' && 'border-amber-500/50 text-amber-400',
                  last.status === 'failed' && 'border-red-500/50 text-red-400'
                )}
              >
                {last.status === 'applied' ? 'aplicado' : last.status === 'fuzzy' ? 'fuzzy' : 'falhou'}
              </Badge>
            )}
            <Switch
              checked={o.enabled}
              onCheckedChange={(v) => window.api.overrides.save({ ...o, enabled: v })}
              className="h-4 w-7 shrink-0 [&_span]:h-3 [&_span]:w-3 data-[state=checked]:[&_span]:translate-x-3"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title="Editar padrão de URL"
              onClick={() => setEditingPattern(o)}
            >
              <Regex className="h-3 w-3" />
            </Button>
            {o.kind === 'edit' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                title="Abrir no editor"
                onClick={() => openOverrideInEditor(o)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-red-400 hover:text-red-300"
              title="Remover"
              onClick={() => window.api.overrides.remove(o.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )
      })}
      {editingPattern && (
        <PatternDialog entry={editingPattern} onClose={() => setEditingPattern(null)} />
      )}
    </div>
  )
}
