import type { NetEntry } from '@shared/types'

export function languageFromEntry(entry: NetEntry): string {
  if (entry.resourceType === 'Script') return 'javascript'
  if (entry.resourceType === 'Stylesheet') return 'css'
  if (entry.resourceType === 'Document') return 'html'
  const mime = entry.mimeType ?? ''
  if (mime.includes('json')) return 'json'
  if (mime.includes('javascript')) return 'javascript'
  if (mime.includes('css')) return 'css'
  if (mime.includes('html')) return 'html'
  const path = entry.url.split('?')[0]
  if (/\.(m?js|jsx)$/.test(path)) return 'javascript'
  if (/\.css$/.test(path)) return 'css'
  if (/\.(html?|xhtml)$/.test(path)) return 'html'
  if (/\.json$/.test(path)) return 'json'
  return 'plaintext'
}

export function contentTypeFromLanguage(lang: string): 'js' | 'css' | 'html' | 'other' {
  if (lang === 'javascript') return 'js'
  if (lang === 'css') return 'css'
  if (lang === 'html') return 'html'
  return 'other'
}

export function languageFromContentType(ct: 'js' | 'css' | 'html' | 'other'): string {
  if (ct === 'js') return 'javascript'
  if (ct === 'css') return 'css'
  if (ct === 'html') return 'html'
  return 'plaintext'
}

/** Tipos de recurso cujo corpo faz sentido abrir no editor. */
export function isTextual(entry: NetEntry): boolean {
  if (['Script', 'Stylesheet', 'Document'].includes(entry.resourceType)) return true
  const mime = entry.mimeType ?? ''
  return /json|javascript|css|html|text|xml|svg/.test(mime)
}

export function fileLabel(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    return seg || u.hostname
  } catch {
    return url
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function formatBytes(n?: number): string {
  if (n === undefined || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
