import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import type { UserScript } from '@shared/schemas'

const TEMPLATE = `// Roda no MUNDO DA PÁGINA, com a origem do site — sem sandbox de extensão.
// Comunicação entre abas (qualquer domínio): window.jwww.bus
//   jwww.bus.emit('meu-topico', { qualquer: 'dado' })
//   jwww.bus.on('meu-topico', (msg) => console.log(msg.data, msg.from))
console.log('[JWWW] script ativo em', location.href)
`

export function ScriptsPanel() {
  const scripts = useApp((s) => s.scripts)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [matches, setMatches] = useState('')
  const [runAt, setRunAt] = useState<'document-start' | 'document-end'>('document-end')
  const [code, setCode] = useState('')

  const selected = scripts.find((s) => s.id === selectedId)

  useEffect(() => {
    if (selected) {
      setName(selected.name)
      setMatches(selected.matches.join('\n'))
      setRunAt(selected.runAt)
      setCode(selected.code)
    }
  }, [selectedId])

  function newScript() {
    setSelectedId(null)
    setName('Novo script')
    setMatches('*')
    setRunAt('document-end')
    setCode(TEMPLATE)
  }

  async function save() {
    const patterns = matches
      .split('\n')
      .map((m) => m.trim())
      .filter(Boolean)
    if (!name.trim() || patterns.length === 0) {
      toast.error('Preencha nome e ao menos um padrão de URL.')
      return
    }
    const entry: UserScript = {
      id: selectedId ?? crypto.randomUUID(),
      name: name.trim(),
      matches: patterns,
      runAt,
      code,
      enabled: selected?.enabled ?? true,
      updatedAt: Date.now()
    }
    await window.api.scripts.save(entry)
    setSelectedId(entry.id)
    toast.success('Script salvo', { description: 'Recarregue as páginas para aplicar.' })
  }

  const editing = selectedId !== null || name !== ''

  return (
    <div className="flex h-full min-h-0">
      {/* lista */}
      <div className="flex w-44 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scripts</span>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={newScript} title="Novo script">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {scripts.length === 0 && (
            <p className="p-2 text-[11px] text-muted-foreground">Nenhum script ainda.</p>
          )}
          {scripts.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={cn(
                'flex cursor-default items-center gap-1.5 rounded px-2 py-1 text-xs',
                s.id === selectedId ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <Switch
                checked={s.enabled}
                onCheckedChange={(v) => window.api.scripts.save({ ...s, enabled: v })}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-6 [&_span]:h-3 [&_span]:w-3 data-[state=checked]:[&_span]:translate-x-2.5"
              />
            </div>
          ))}
        </div>
      </div>

      {/* editor do script */}
      {!editing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
          <p>
            Userscripts são injetados <span className="font-semibold text-foreground/80">no mundo da página</span> —
            rodam com a mesma origem do site, então podem chamar as APIs internas dele sem CORS.
          </p>
          <p>
            Use <code className="font-mono text-violet-400">window.jwww.bus</code> para conversar entre abas de
            domínios diferentes.
          </p>
          <Button size="sm" variant="secondary" onClick={newScript}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Criar script
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border p-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome"
              className="h-7 w-40 select-text text-xs"
            />
            <select
              value={runAt}
              onChange={(e) => setRunAt(e.target.value as typeof runAt)}
              className="h-7 rounded-md border-none bg-secondary/60 px-2 text-xs outline-none"
            >
              <option value="document-start">document-start</option>
              <option value="document-end">document-end</option>
            </select>
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={save}>
              <Save className="mr-1 h-3 w-3" /> Salvar
            </Button>
            {selected && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-red-400"
                onClick={async () => {
                  await window.api.scripts.remove(selected.id)
                  newScript()
                  toast.success('Script removido')
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="shrink-0 border-b border-border p-2">
            <Textarea
              value={matches}
              onChange={(e) => setMatches(e.target.value)}
              placeholder={'Padrões de URL, um por linha. Ex:\nhttps://*.exemplo.com/*\n*'}
              spellCheck={false}
              className="min-h-[44px] select-text font-mono text-[11px]"
              rows={2}
            />
          </div>
          <div className="min-h-0 flex-1 select-text">
            <Editor
              height="100%"
              language="javascript"
              value={code}
              onChange={(v) => setCode(v ?? '')}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
