import { stripHash } from './overrides'

/**
 * Subresource Integrity: o browser calcula o hash do arquivo baixado e compara
 * com o atributo `integrity`. Um arquivo com override tem hash diferente, então
 * seria bloqueado. Removemos o atributo apenas das tags cujo recurso realmente
 * tem override ativo — o resto da página segue protegido pelo SRI.
 */
const TAG_RE = /<(script|link)\b[^>]*>/gi
const INTEGRITY_RE = /\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i
const URL_ATTR_RE = /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

function resolve(raw: string, baseUrl: string): string | null {
  try {
    return stripHash(new URL(raw, baseUrl).toString())
  } catch {
    return null
  }
}

export function stripIntegrity(
  html: string,
  documentUrl: string,
  hasOverride: (url: string) => boolean
): { text: string; stripped: string[] } {
  if (!/integrity\s*=/i.test(html)) return { text: html, stripped: [] }

  const stripped: string[] = []
  const text = html.replace(TAG_RE, (tag) => {
    if (!INTEGRITY_RE.test(tag)) return tag
    const m = tag.match(URL_ATTR_RE)
    const raw = m?.[1] ?? m?.[2] ?? m?.[3]
    if (!raw) return tag
    const resolved = resolve(raw, documentUrl)
    if (!resolved || !hasOverride(resolved)) return tag
    stripped.push(resolved)
    return tag.replace(INTEGRITY_RE, '')
  })

  return { text, stripped }
}

/**
 * CSP também bloqueia conteúdo modificado (hashes em script-src) e atrapalha
 * userscripts que injetam elementos. Removido só quando o dev liga o toggle.
 */
const CSP_HEADERS = new Set(['content-security-policy', 'content-security-policy-report-only'])

export function isCspHeader(name: string): boolean {
  return CSP_HEADERS.has(name.toLowerCase())
}

const META_CSP_RE = /<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi

export function stripMetaCsp(html: string): string {
  return html.replace(META_CSP_RE, '')
}
