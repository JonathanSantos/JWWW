import { useState } from 'react'
import { Download, FolderUp, RotateCcw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useApp } from '@/store/app'
import type { Workspace } from '@shared/schemas'

function Counts({ ws }: { ws: Workspace }) {
  const parts = [
    ws.overrides.length && `${ws.overrides.length} override${ws.overrides.length > 1 ? 's' : ''}`,
    ws.scripts.length && `${ws.scripts.length} script${ws.scripts.length > 1 ? 's' : ''}`,
    ws.rules.length && `${ws.rules.length} regra${ws.rules.length > 1 ? 's' : ''}`
  ].filter(Boolean)
  return <>{parts.length ? parts.join(' · ') : 'vazia'}</>
}

export function WorkspacesPanel() {
  const workspaces = useApp((s) => s.workspaces)
  const overrides = useApp((s) => s.overrides)
  const scripts = useApp((s) => s.scripts)
  const rules = useApp((s) => s.rules)

  const [name, setName] = useState('')
  const [pendingRestore, setPendingRestore] = useState<Workspace | null>(null)
  const currentTotal = overrides.length + scripts.length + rules.length

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Dê um nome para a sessão.')
      return
    }
    await window.api.workspaces.save(trimmed)
    setName('')
    toast.success(`Sessão "${trimmed}" salva`)
  }

  async function confirmRestore() {
    const ws = pendingRestore
    if (!ws) return
    setPendingRestore(null)
    await window.api.workspaces.restore(ws.id)
    toast.success(`Sessão "${ws.name}" restaurada`, {
      description: 'Recarregue as páginas abertas para aplicar.'
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <p className="text-[11px] text-muted-foreground">
          Uma sessão é um retrato de tudo que você configurou — overrides, scripts e regras de rede — para
          versionar no git ou passar para o time.
        </p>
        <div className="flex items-center gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Nome da sessão atual…"
            className="h-7 min-w-0 flex-1 select-text text-xs"
          />
          <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" onClick={save}>
            <Save className="mr-1 h-3 w-3" /> Salvar atual
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-xs"
            title="Importar sessão de um arquivo"
            onClick={async () => {
              try {
                const ws = await window.api.workspaces.importFromFile()
                if (ws) toast.success(`Sessão "${ws.name}" importada`)
              } catch (err) {
                toast.error('Arquivo de sessão inválido', { description: String(err) })
              }
            }}
          >
            <FolderUp className="mr-1 h-3 w-3" /> Importar
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          Estado atual: {currentTotal === 0 ? 'nada configurado' : `${overrides.length} override(s), ${scripts.length} script(s), ${rules.length} regra(s)`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {workspaces.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nenhuma sessão salva ainda.
          </p>
        )}
        {workspaces
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((ws) => (
            <div
              key={ws.id}
              className="mb-1.5 flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{ws.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  <Counts ws={ws} /> · {new Date(ws.createdAt).toLocaleString()}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                title="Restaurar esta sessão"
                onClick={() => setPendingRestore(ws)}
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                title="Exportar para arquivo"
                onClick={async () => {
                  const path = await window.api.workspaces.exportToFile(ws.id)
                  if (path) toast.success('Sessão exportada', { description: path })
                }}
              >
                <Download className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-red-400 hover:text-red-300"
                title="Excluir sessão salva"
                onClick={() => window.api.workspaces.remove(ws.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
      </div>

      <Dialog open={pendingRestore !== null} onOpenChange={(open) => !open && setPendingRestore(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restaurar “{pendingRestore?.name}”?</DialogTitle>
            <DialogDescription>
              Isto <strong>substitui</strong> os overrides, scripts e regras atuais
              {currentTotal > 0 && ' — o que está configurado agora será perdido se não estiver salvo'}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmRestore}>Restaurar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
