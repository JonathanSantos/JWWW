import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CornerDownLeft, Terminal, Trash2, TriangleAlert, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useActiveTab, useApp } from '@/store/app'
import { LinhaDeValores, RemoteValue } from './RemoteValue'
import type { ConsoleEntry, ConsoleLevel } from '@shared/types'

const EMPTY: ConsoleEntry[] = []
const LIMITE_VISIVEL = 300

const FILTROS: Array<{ valor: 'tudo' | 'erros' | 'avisos'; rotulo: string }> = [
  { valor: 'tudo', rotulo: 'tudo' },
  { valor: 'avisos', rotulo: 'avisos e erros' },
  { valor: 'erros', rotulo: 'só erros' }
]

const ESTILO_POR_NIVEL: Record<ConsoleLevel, string> = {
  log: '',
  info: '',
  debug: 'text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-200',
  error: 'bg-red-500/10 text-red-200',
  input: 'text-muted-foreground',
  result: ''
}

function Marcador({ nivel }: { nivel: ConsoleLevel }) {
  if (nivel === 'error') return <XCircle className="mt-[3px] h-3 w-3 shrink-0 text-red-400" />
  if (nivel === 'warn') return <TriangleAlert className="mt-[3px] h-3 w-3 shrink-0 text-amber-400" />
  if (nivel === 'input') return <ChevronRight className="mt-[3px] h-3 w-3 shrink-0 text-sky-400" />
  if (nivel === 'result')
    return <CornerDownLeft className="mt-[3px] h-3 w-3 shrink-0 text-muted-foreground" />
  return <span className="w-3 shrink-0" />
}

export function ConsolePanel() {
  const active = useActiveTab()
  const entradas = useApp((s) => (active ? s.consoleLog[active.id] : undefined)) ?? EMPTY
  const pushLocal = useApp((s) => s.pushConsoleLocal)
  const limparLocal = useApp((s) => s.clearConsoleLog)

  const [expressao, setExpressao] = useState('')
  const [filtro, setFiltro] = useState<'tudo' | 'erros' | 'avisos'>('tudo')
  const [busca, setBusca] = useState('')
  const [historico, setHistorico] = useState<string[]>([])
  const [posicaoHistorico, setPosicaoHistorico] = useState<number | null>(null)

  const fimRef = useRef<HTMLDivElement>(null)
  const entradaRef = useRef<HTMLTextAreaElement>(null)

  const visiveis = entradas.filter((e) => {
    if (filtro === 'erros' && e.level !== 'error') return false
    if (filtro === 'avisos' && e.level !== 'error' && e.level !== 'warn') return false
    if (!busca) return true
    const texto = e.args.map((a) => String(a.value ?? a.description ?? '')).join(' ')
    return texto.toLowerCase().includes(busca.toLowerCase())
  })
  const recortadas = visiveis.slice(-LIMITE_VISIVEL)

  // rolar para o fim quando chega coisa nova
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [entradas.length])

  async function avaliar() {
    const texto = expressao.trim()
    if (!texto || !active) return

    setHistorico((h) => (h[h.length - 1] === texto ? h : [...h.slice(-99), texto]))
    setPosicaoHistorico(null)
    setExpressao('')

    pushLocal(active.id, {
      id: `in${Date.now()}`,
      tabId: active.id,
      level: 'input',
      args: [{ type: 'string', value: texto }],
      at: Date.now()
    })

    const r = await window.api.console.evaluate(active.id, texto)
    pushLocal(active.id, {
      id: `out${Date.now()}`,
      tabId: active.id,
      level: r.ok ? 'result' : 'error',
      args: r.value
        ? [r.value]
        : [{ type: 'string', value: r.error ?? 'erro desconhecido' }],
      at: Date.now()
    })
  }

  function navegarHistorico(direcao: -1 | 1) {
    if (historico.length === 0) return
    const atual = posicaoHistorico ?? historico.length
    const proximo = Math.min(historico.length, Math.max(0, atual + direcao))
    setPosicaoHistorico(proximo)
    setExpressao(proximo >= historico.length ? '' : historico[proximo])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar mensagens…"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 select-text rounded-md bg-secondary/60 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:bg-secondary"
        />
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as typeof filtro)}
          className="h-7 rounded-md border-none bg-secondary/60 px-2 text-[11px] outline-none"
        >
          {FILTROS.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.rotulo}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Limpar console"
          onClick={() => active && (window.api.console.clear(active.id), limparLocal(active.id))}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed">
        {recortadas.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center font-sans text-xs text-muted-foreground">
            <Terminal className="h-5 w-5 opacity-40" />
            <p>
              {entradas.length === 0
                ? 'Nada no console ainda.'
                : 'Nenhuma mensagem corresponde ao filtro.'}
            </p>
            <p>Escreva embaixo para avaliar no contexto da página.</p>
          </div>
        )}
        {visiveis.length > recortadas.length && (
          <div className="px-2 py-1 font-sans text-[10px] text-muted-foreground">
            mostrando as {recortadas.length} mais recentes de {visiveis.length}
          </div>
        )}
        {recortadas.map((e) => (
          <div
            key={e.id}
            className={cn(
              'flex items-start gap-1.5 border-b border-border/30 px-2 py-1',
              ESTILO_POR_NIVEL[e.level]
            )}
          >
            <Marcador nivel={e.level} />
            <div className="min-w-0 flex-1 select-text break-words">
              {e.level === 'input' ? (
                <span className="text-foreground/80">{String(e.args[0]?.value ?? '')}</span>
              ) : e.args.length === 1 && e.level === 'result' ? (
                <RemoteValue valor={e.args[0]} tabId={e.tabId} />
              ) : (
                <LinhaDeValores args={e.args} tabId={e.tabId} />
              )}
              {e.stack && (
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-muted-foreground">{e.stack}</pre>
              )}
            </div>
            {e.origem && (
              <span
                className="max-w-[38%] shrink-0 truncate text-right text-[10px] text-muted-foreground/70"
                title={e.origem}
              >
                {e.origem.replace(/^https?:\/\//, '')}
              </span>
            )}
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      <div className="flex shrink-0 items-start gap-1.5 border-t border-border p-2">
        <ChevronRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
        <textarea
          ref={entradaRef}
          value={expressao}
          onChange={(e) => setExpressao(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void avaliar()
            } else if (e.key === 'ArrowUp' && !expressao.includes('\n')) {
              e.preventDefault()
              navegarHistorico(-1)
            } else if (e.key === 'ArrowDown' && !expressao.includes('\n')) {
              e.preventDefault()
              navegarHistorico(1)
            }
          }}
          rows={1}
          placeholder={active ? 'expressão JS — Enter avalia, ⇧Enter quebra linha' : 'nenhuma aba ativa'}
          disabled={!active}
          spellCheck={false}
          className="max-h-24 min-h-[24px] w-full resize-none select-text bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>
    </div>
  )
}
