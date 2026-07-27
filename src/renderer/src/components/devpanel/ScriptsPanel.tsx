import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Plus, Save, Sparkles, Trash2 } from 'lucide-react'
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

/**
 * Pontos de partida. O toolkit (`jwww.ui`) está sempre disponível na página,
 * então é só colar e salvar.
 */
const MODELOS: Array<{ nome: string; descricao: string; codigo: string }> = [
  {
    nome: 'Painel lateral',
    descricao: 'Botão flutuante que abre uma sidebar em shadow DOM',
    codigo: `const painel = jwww.ui.sidebar({
  id: 'meu-painel',
  titulo: 'Meu painel',
  botao: '🛠',          // botão flutuante que abre/fecha
  lado: 'direita'
})

const contador = jwww.ui.estado(0)

// re-renderiza sozinho quando um estado lido aqui dentro muda
painel.render(({ html }) => html\`
  <h3>Olá, \${location.hostname}</h3>
  <p>Cliques: \${contador.get()}</p>
  <button onclick=\${() => contador.mude((n) => n + 1)}>Somar</button>
\`)`
  },
  {
    nome: 'Espelhar valor do site',
    descricao: 'Lê um valor exposto do bundle e mostra no painel',
    codigo: `// 1) No Editor, selecione o trecho do JS do site e use "Expor global"
//    dando o nome \`estadoDoApp\`.
// 2) Este script espera o valor aparecer e o mostra ao vivo.

const painel = jwww.ui.painel({ id: 'espelho', titulo: 'Estado do app' })
const valor = jwww.ui.estado(null)

jwww.globals
  .get('estadoDoApp')
  .then((v) => valor.set(v))
  .catch((e) => valor.set({ erro: String(e) }))

painel.render(({ html }) => html\`
  <pre>\${JSON.stringify(valor.get(), null, 2) ?? 'esperando…'}</pre>
\`)`
  },
  {
    nome: 'Painel entre abas',
    descricao: 'Estado compartilhado entre abas de domínios diferentes',
    codigo: `// Rode este mesmo script em abas de sites diferentes: o valor é o mesmo
// nas duas, porque trafega pelo IPC do JWWW e não pela web.

const notas = jwww.compartilhado('notas', [])
const painel = jwww.ui.sidebar({ id: 'notas', titulo: 'Notas (todas as abas)', botao: '📝' })

painel.render(({ html }) => html\`
  <input id="nova" placeholder="escreva e tecle Enter"
    onkeydown=\${(e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return
      notas.mude((lista) => [...lista, { texto: e.target.value, de: location.hostname }])
      e.target.value = ''
    }} />
  <ul>
    \${notas.get().map((n) => html\`<li>\${n.texto} <small>— \${n.de}</small></li>\`)}
  </ul>
\`)`
  },
  {
    nome: 'Controlar outra aba',
    descricao: 'Uma aba atende, outra chama — mesmo em domínio diferente',
    codigo: `// Nesta aba: publica uma capacidade que outras abas podem chamar.
jwww.rpc.atender('titulo', () => document.title)
jwww.rpc.atender('buscar', (seletor) => {
  const el = document.querySelector(seletor)
  return el ? el.textContent.trim() : null
})

// De QUALQUER outra aba (inclusive outro domínio):
//   await jwww.rpc.chamar('titulo')
//   await jwww.rpc.chamar('buscar', 'h1')

const painel = jwww.ui.painel({ id: 'rpc', titulo: 'Controle remoto' })
const saida = jwww.ui.estado('—')

painel.render(({ html }) => html\`
  <p>Título de outra aba:</p>
  <pre>\${saida.get()}</pre>
  <button onclick=\${async () => {
    try { saida.set(await jwww.rpc.chamar('titulo')) }
    catch (e) { saida.set(String(e.message)) }
  }}>Perguntar</button>
\`)`
  }
]

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

  function usarModelo(modelo: (typeof MODELOS)[number]) {
    setSelectedId(null)
    setName(modelo.nome)
    setMatches('*')
    setRunAt('document-end')
    setCode(modelo.codigo)
  }

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
            O toolkit <code className="font-mono text-violet-400">jwww.ui</code> monta painéis em shadow DOM, e{' '}
            <code className="font-mono text-violet-400">jwww.compartilhado</code> /{' '}
            <code className="font-mono text-violet-400">jwww.rpc</code> ligam abas de domínios diferentes.
          </p>
          <Button size="sm" variant="secondary" onClick={newScript}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Script em branco
          </Button>
          <div className="mt-2 w-full max-w-sm space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              ou comece por um modelo
            </div>
            {MODELOS.map((m) => (
              <button
                key={m.nome}
                onClick={() => usarModelo(m)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border/60 px-2.5 py-1.5 text-left transition-colors hover:bg-secondary/50"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Sparkles className="h-3 w-3 text-violet-400" /> {m.nome}
                </span>
                <span className="text-[10px] text-muted-foreground">{m.descricao}</span>
              </button>
            ))}
          </div>
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
