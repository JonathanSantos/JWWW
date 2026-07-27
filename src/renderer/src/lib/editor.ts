import { toast } from 'sonner'
import type { NetEntry } from '@shared/types'
import type { OverrideEntry } from '@shared/schemas'
import { useApp } from '@/store/app'
import { isTextual, languageFromContentType, languageFromEntry } from '@/lib/lang'
import { overrideMatches } from '@shared/glob'

export async function openResourceInEditor(entry: NetEntry) {
  if (!isTextual(entry)) return
  const store = useApp.getState()
  const url = entry.url.split('#')[0]

  const existing = store.files.find((f) => f.url === url)
  if (existing) {
    store.setActiveFile(url)
    store.setPanelTab('editor')
    return
  }

  const override = store.overrides.find((o) => o.kind === 'edit' && overrideMatches(o, url))
  let originalText: string
  let text: string
  if (override) {
    // Já existe override: edita sobre a base gravada, não sobre o corpo servido
    // (que provavelmente já é o resultado do override aplicado).
    originalText = override.originalText
    text = override.editedText ?? override.originalText
  } else {
    const res = await window.api.net.getBody(entry.tabId, entry.id, url)
    if (!res.ok || res.text === undefined) {
      toast.error('Não foi possível obter o corpo do arquivo', { description: res.error })
      return
    }
    originalText = res.text
    text = res.text
  }

  store.openFile({
    url,
    tabId: entry.tabId,
    language: languageFromEntry(entry),
    originalText,
    text,
    dirty: false
  })
  store.setPanelTab('editor')
}

export function openOverrideInEditor(override: OverrideEntry) {
  const store = useApp.getState()
  const activeTab = store.tabs.find((t) => t.active)
  const existing = store.files.find((f) => f.url === override.url)
  if (!existing) {
    store.openFile({
      url: override.url,
      tabId: activeTab?.id ?? -1,
      language: languageFromContentType(override.contentType),
      originalText: override.originalText,
      text: override.editedText ?? override.originalText,
      dirty: false
    })
  } else {
    store.setActiveFile(override.url)
  }
  store.setPanelTab('editor')
}
