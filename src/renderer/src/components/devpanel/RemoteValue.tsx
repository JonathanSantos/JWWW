import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RemoteValue as Valor } from '@shared/types'

/** Cores por tipo, como qualquer console — a leitura fica muito mais rápida. */
function corDoTipo(v: Valor): string {
  if (v.subtype === 'null' || v.type === 'undefined') return 'text-muted-foreground'
  switch (v.type) {
    case 'string':
      return 'text-orange-300'
    case 'number':
    case 'bigint':
      return 'text-sky-300'
    case 'boolean':
      return 'text-violet-300'
    case 'function':
      return 'text-yellow-300'
    case 'symbol':
      return 'text-emerald-300'
    default:
      return 'text-foreground/90'
  }
}

function resumoDeFuncao(v: Valor): string {
  const d = v.description ?? 'function'
  const m = d.match(/^(?:async\s+)?(?:function\*?\s*)?([A-Za-z0-9_$]*)\s*\(/)
  const nome = m?.[1]
  return `ƒ ${nome || '(anônima)'}()`
}

/** Prévia de uma linha: `{a: 1, b: "x"}` ou `Array(3) [1, 2, 3]`. */
function textoDaPrevia(v: Valor): string {
  if (!v.preview) return v.description ?? v.className ?? 'Object'
  const props = v.preview.properties.map((p) =>
    v.subtype === 'array' ? (p.value ?? '…') : `${p.name}: ${p.value ?? '…'}`
  )
  if (v.preview.overflow) props.push('…')
  const corpo = props.join(', ')
  if (v.subtype === 'array') return `${v.description ?? 'Array'} [${corpo}]`
  const prefixo = v.className && v.className !== 'Object' ? `${v.className} ` : ''
  return `${prefixo}{${corpo}}`
}

function ehExpansivel(v: Valor): boolean {
  return Boolean(v.objectId) && v.type === 'object' && v.subtype !== 'null'
}

type Props = {
  valor: Valor
  tabId: number
  /** strings de console.log saem sem aspas; dentro de objeto, com aspas */
  cruaSeString?: boolean
  nivel?: number
}

export function RemoteValue({ valor, tabId, cruaSeString, nivel = 0 }: Props) {
  const [aberto, setAberto] = useState(false)
  const [filhos, setFilhos] = useState<Array<{ name: string; value: Valor }> | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function alternar() {
    if (aberto) {
      setAberto(false)
      return
    }
    setAberto(true)
    if (filhos || !valor.objectId) return
    const r = await window.api.console.getProperties(tabId, valor.objectId)
    if (r.ok && r.properties) setFilhos(r.properties)
    else setErro(r.error ?? 'não foi possível expandir')
  }

  if (valor.type === 'string') {
    const texto = String(valor.value ?? '')
    return (
      <span className={cruaSeString ? 'text-foreground/90' : 'text-orange-300'}>
        {cruaSeString ? texto : `"${texto}"`}
      </span>
    )
  }

  if (valor.type === 'function') {
    return <span className="text-yellow-300" title={valor.description}>{resumoDeFuncao(valor)}</span>
  }

  if (!ehExpansivel(valor)) {
    const texto =
      valor.subtype === 'null'
        ? 'null'
        : valor.type === 'undefined'
          ? 'undefined'
          : (valor.description ?? String(valor.value))
    return <span className={corDoTipo(valor)}>{texto}</span>
  }

  // erro tem tratamento próprio: mostrar a pilha inteira é mais útil que a prévia
  if (valor.subtype === 'error') {
    return <span className="whitespace-pre-wrap text-red-300">{valor.description}</span>
  }

  return (
    <span>
      <span
        onClick={alternar}
        className="cursor-pointer select-none rounded px-0.5 hover:bg-secondary/60"
        title={aberto ? 'recolher' : 'expandir'}
      >
        {aberto ? (
          <ChevronDown className="mr-0.5 inline h-3 w-3 align-[-1px] text-muted-foreground" />
        ) : (
          <ChevronRight className="mr-0.5 inline h-3 w-3 align-[-1px] text-muted-foreground" />
        )}
        <span className="text-foreground/90">{textoDaPrevia(valor)}</span>
      </span>

      {aberto && (
        <span className="block" style={{ paddingLeft: `${(nivel + 1) * 12}px` }}>
          {erro && <span className="text-[11px] text-red-400">{erro}</span>}
          {!erro && !filhos && <span className="text-[11px] text-muted-foreground">carregando…</span>}
          {filhos?.map((p) => (
            <span key={p.name} className="block">
              <span className="text-violet-300">{p.name}</span>
              <span className="text-muted-foreground">: </span>
              <RemoteValue valor={p.value} tabId={tabId} nivel={nivel + 1} />
            </span>
          ))}
          {filhos?.length === 0 && (
            <span className="text-[11px] text-muted-foreground">(sem propriedades próprias)</span>
          )}
        </span>
      )}
    </span>
  )
}

/**
 * Só um punhado de propriedades de `%c` é aceito. O CSS vem do site, então
 * limitar evita que um log quebre o layout do painel.
 */
const CSS_PERMITIDO = new Set([
  'color',
  'background',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration'
])

function estiloDeCss(css: string): React.CSSProperties {
  const estilo: Record<string, string> = {}
  for (const parte of css.split(';')) {
    const [chave, ...resto] = parte.split(':')
    const nome = chave?.trim().toLowerCase()
    const valor = resto.join(':').trim()
    if (!nome || !valor || !CSS_PERMITIDO.has(nome)) continue
    const camel = nome.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
    estilo[camel] = valor
  }
  return estilo as React.CSSProperties
}

type Segmento =
  | { tipo: 'texto'; texto: string; estilo?: React.CSSProperties }
  | { tipo: 'valor'; valor: Valor }

/**
 * Aplica as diretivas de formatação do console (`%s`, `%d`, `%o`, `%c`) como
 * qualquer console faz. Sem isso, `console.log("%cTítulo", "color:red")` — que
 * muito site usa — apareceria com o `%c` e o CSS crus na tela.
 */
function formatar(args: Valor[]): Segmento[] {
  const primeiro = args[0]
  if (primeiro?.type !== 'string' || !String(primeiro.value ?? '').includes('%')) {
    return args.map((valor) => ({ tipo: 'valor', valor }))
  }

  const modelo = String(primeiro.value ?? '')
  const segmentos: Segmento[] = []
  let acumulado = ''
  let estiloAtual: React.CSSProperties | undefined
  let proximo = 1

  const descarregar = () => {
    if (!acumulado) return
    segmentos.push({ tipo: 'texto', texto: acumulado, estilo: estiloAtual })
    acumulado = ''
  }

  for (let i = 0; i < modelo.length; i++) {
    if (modelo[i] !== '%' || i === modelo.length - 1) {
      acumulado += modelo[i]
      continue
    }
    const diretiva = modelo[i + 1]
    if (diretiva === '%') {
      acumulado += '%'
      i++
      continue
    }
    if (!'sdifoOc'.includes(diretiva)) {
      acumulado += modelo[i]
      continue
    }

    const arg = args[proximo]
    if (arg === undefined) {
      acumulado += modelo[i]
      continue
    }
    proximo++
    i++

    if (diretiva === 'c') {
      // o argumento é CSS, não conteúdo: muda o estilo do que vem depois
      descarregar()
      estiloAtual = estiloDeCss(String(arg.value ?? ''))
      continue
    }
    if (diretiva === 'o' || diretiva === 'O') {
      descarregar()
      segmentos.push({ tipo: 'valor', valor: arg })
      continue
    }
    if (diretiva === 'd' || diretiva === 'i') {
      const n = Number(arg.value)
      acumulado += Number.isFinite(n) ? String(Math.trunc(n)) : 'NaN'
      continue
    }
    if (diretiva === 'f') {
      const n = Number(arg.value)
      acumulado += Number.isFinite(n) ? String(n) : 'NaN'
      continue
    }
    // %s
    acumulado +=
      arg.type === 'string' ? String(arg.value ?? '') : (arg.description ?? String(arg.value ?? ''))
  }
  descarregar()

  // o que sobrou de argumentos sai depois, como o console faz
  for (let i = proximo; i < args.length; i++) segmentos.push({ tipo: 'valor', valor: args[i] })
  return segmentos
}

/** Uma linha de argumentos, como o console imprime: separados por espaço. */
export function LinhaDeValores({ args, tabId }: { args: Valor[]; tabId: number }) {
  const segmentos = formatar(args)
  return (
    <span className={cn('min-w-0 break-words')}>
      {segmentos.map((s, i) => (
        <span key={i}>
          {i > 0 && s.tipo === 'valor' && ' '}
          {s.tipo === 'texto' ? (
            <span style={s.estilo}>{s.texto}</span>
          ) : (
            <RemoteValue valor={s.valor} tabId={tabId} cruaSeString />
          )}
        </span>
      ))}
    </span>
  )
}
