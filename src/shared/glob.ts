const cache = new Map<string, RegExp | null>()

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `*` casa qualquer sequência de caracteres, inclusive `/`. */
export function globToRegExp(pattern: string): RegExp | null {
  if (cache.has(pattern)) return cache.get(pattern)!
  let re: RegExp | null = null
  try {
    re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$')
  } catch {
    re = null
  }
  cache.set(pattern, re)
  return re
}

/** Casamento estrito da URL inteira contra o glob. */
export function globMatch(pattern: string, value: string): boolean {
  const re = globToRegExp(pattern)
  return re ? re.test(value) : false
}

/**
 * Regra única de casamento de override, usada tanto na interceptação quanto na
 * UI — se divergirem, o editor cria duplicatas de um override que já se aplica.
 */
export function overrideMatches(o: { url: string; pattern?: string }, url: string): boolean {
  return o.pattern ? globMatch(o.pattern, url) : o.url === url
}

/** Regras de rede são mais soltas: sem `*`, vale substring. */
export function looseMatch(pattern: string, value: string): boolean {
  if (pattern.includes('*')) return globMatch(pattern, value)
  return value.includes(pattern)
}

/**
 * Padrão que limita um userscript à origem de uma página.
 *
 * É o padrão de um script novo: o default anterior era `*`, e um script escrito
 * para um site rodava em todos os outros — inclusive no seu banco, com a origem
 * deles. Um script amplo continua possível, mas passa a ser escolha explícita.
 */
export function padraoDeOrigem(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.protocol.startsWith('http')) return null
    return `${u.origin}/*`
  } catch {
    return null
  }
}

/**
 * URLs de origens sem relação nenhuma entre si. Um padrão que casa com as duas
 * casa com qualquer coisa — testar é mais confiável do que tentar reconhecer as
 * várias formas de escrever "tudo" (um asterisco sozinho, `http*`, curingas no
 * lugar do esquema e do host…).
 */
const CANARIOS = ['https://banco.exemplo.com.br/minha-conta', 'http://outra.coisa.dev/a/b?c=1']

/** O padrão roda em qualquer site? Usado para pedir confirmação antes de salvar. */
export function ehPadraoAmplo(pattern: string): boolean {
  return CANARIOS.every((u) => globMatch(pattern, u))
}

const HASHISH = /^(?=.*\d)[a-z0-9]{6,}$/i
const HEXISH = /^[a-f0-9]{6,}$/i

/**
 * Builds modernos põem o hash do conteúdo no nome (`app.a3f9b1.js`), então um
 * override por URL exata morre no próximo deploy. Trocamos os trechos que
 * parecem hash por `*` para o override sobreviver.
 */
export function suggestPattern(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const segments = parsed.pathname.split('/')
  const file = segments.pop() ?? ''
  if (!file) return null

  const tokens = file.split(/([.\-_])/)
  let changed = false
  const rebuilt = tokens.map((tok, i) => {
    // separadores ficam nos índices ímpares por causa do grupo de captura
    if (i % 2 === 1) return tok
    if (tok.length >= 6 && (HEXISH.test(tok) || HASHISH.test(tok))) {
      changed = true
      return '*'
    }
    return tok
  })

  const hasQuery = parsed.search.length > 0
  if (!changed && !hasQuery) return null

  const path = [...segments, rebuilt.join('')].join('/')
  return `${parsed.origin}${path}${hasQuery ? '*' : ''}`
}
