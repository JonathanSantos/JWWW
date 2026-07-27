import { useState } from 'react'
import {
  ClipboardPaste,
  Copy,
  FileCode2,
  Globe2,
  Pencil,
  Power,
  Regex,
  Trash2,
  TriangleAlert
} from 'lucide-react'
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
import { useActiveTab, useApp } from '@/store/app'
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
  const statusPorOverride = useApp((s) => s.statusPorOverride)
  const active = useActiveTab()
  const [editingPattern, setEditingPattern] = useState<OverrideEntry | null>(null)

  const ativos = overrides.filter((o) => o.enabled).length
  const degradados = overrides.filter((o) => {
    const st = statusPorOverride[o.id]
    return o.enabled && st && st.status !== 'applied'
  }).length

  async function alternarTodos() {
    const ligar = ativos === 0
    await window.api.overrides.setAllEnabled(ligar)
    if (active) await window.api.tabs.reload(active.id, true)
    toast.success(ligar ? 'Todos os overrides religados' : 'Todos os overrides desligados', {
      description: active ? 'A página foi recarregada sem cache.' : undefined
    })
  }

  async function colar() {
    const r = await window.api.overrides.paste()
    if (r.ok) toast.success('Override colado', { description: r.url })
    else toast.error('Não deu para colar', { description: r.error })
  }

  const cabecalho = (
    <div className="flex shrink-0 items-center gap-2 border-b border-border p-2 text-[11px]">
      <span className="text-muted-foreground">
        {ativos} de {overrides.length} {overrides.length === 1 ? 'ativo' : 'ativos'}
      </span>
      {degradados > 0 && (
        <span className="flex items-center gap-1 text-amber-400">
          <TriangleAlert className="h-3 w-3" />
          {degradados} não aplicou como estava
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Colar um override copiado"
          onClick={colar}
        >
          <ClipboardPaste className="h-3 w-3" />
        </Button>
        {overrides.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-[11px]"
            title="Responde “sou eu ou é o site?” de uma vez, recarregando sem cache"
            onClick={alternarTodos}
          >
            <Power className="mr-1 h-3 w-3" />
            {ativos === 0 ? 'Religar tudo' : 'Desligar tudo'}
          </Button>
        )}
      </div>
    </div>
  )

  if (overrides.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {cabecalho}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
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
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {cabecalho}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {overrides.map((o) => {
        const last = statusPorOverride[o.id]
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
              {/* O motivo importa mais que o rótulo: é ele que diz o que fazer. */}
              {last && last.status !== 'applied' && last.message && (
                <div
                  className={cn(
                    'mt-0.5 text-[10px] leading-snug',
                    last.status === 'failed' ? 'text-red-300/90' : 'text-amber-300/90'
                  )}
                >
                  {last.message}
                </div>
              )}
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
              className="h-6 w-6 shrink-0"
              title="Copiar este override (para mandar para outra pessoa)"
              onClick={async () => {
                const r = await window.api.overrides.copy(o.id)
                if (r.ok) toast.success('Override copiado', { description: fileLabel(o.url) })
                else toast.error('Não deu para copiar', { description: r.error })
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
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
      </div>
      {editingPattern && (
        <PatternDialog entry={editingPattern} onClose={() => setEditingPattern(null)} />
      )}
    </div>
  )
}
