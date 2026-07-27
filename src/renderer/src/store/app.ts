import { create } from 'zustand'
import type { BusMessage, NetEntry, OverrideStatusEvent, TabState, WatchEvent } from '@shared/types'
import type { NetRule, OverrideEntry, UserScript, Workspace } from '@shared/schemas'

import type { PrettyAnchor } from '@/lib/prettify'

export type EditorFile = {
  url: string
  tabId: number
  language: string
  /** snapshot do arquivo como veio do servidor — base do diff do override */
  originalText: string
  /** sempre no espaço do arquivo original (formatação do servidor preservada) */
  text: string
  dirty: boolean
  /**
   * Presente enquanto a visão formatada está ligada. O editor mostra
   * `prettyText`; `text` só é recalculado a partir dele na hora de salvar.
   */
  pretty?: { anchor: PrettyAnchor; prettyText: string }
}

type AppState = {
  tabs: TabState[]
  net: Record<number, NetEntry[]>
  panelOpen: boolean
  panelTab: string
  overrides: OverrideEntry[]
  scripts: UserScript[]
  rules: NetRule[]
  workspaces: Workspace[]
  statuses: OverrideStatusEvent[]
  busLog: BusMessage[]
  watchLog: WatchEvent[]
  files: EditorFile[]
  activeFileUrl: string | null

  setTabs: (tabs: TabState[]) => void
  upsertNet: (entries: NetEntry[]) => void
  clearNet: (tabId: number) => void
  togglePanel: () => void
  setPanelTab: (tab: string) => void
  setOverrides: (o: OverrideEntry[]) => void
  setScripts: (s: UserScript[]) => void
  setRules: (r: NetRule[]) => void
  setWorkspaces: (w: Workspace[]) => void
  pushStatus: (ev: OverrideStatusEvent) => void
  pushBus: (m: BusMessage) => void
  setBusLog: (m: BusMessage[]) => void
  pushWatch: (e: WatchEvent) => void
  clearWatchLog: () => void
  openFile: (f: EditorFile) => void
  closeFile: (url: string) => void
  setActiveFile: (url: string) => void
  updateFileText: (url: string, text: string) => void
  markFileSaved: (url: string) => void
  setFilePretty: (url: string, pretty: EditorFile['pretty']) => void
  commitFileText: (url: string, text: string) => void
}

export const useApp = create<AppState>((set) => ({
  tabs: [],
  net: {},
  panelOpen: true,
  panelTab: 'resources',
  overrides: [],
  scripts: [],
  rules: [],
  workspaces: [],
  statuses: [],
  busLog: [],
  watchLog: [],
  files: [],
  activeFileUrl: null,

  setTabs: (tabs) => set({ tabs }),

  upsertNet: (entries) =>
    set((s) => {
      const net = { ...s.net }
      for (const e of entries) {
        const list = net[e.tabId] ? [...net[e.tabId]] : []
        const i = list.findIndex((x) => x.id === e.id)
        if (i === -1) list.push(e)
        else list[i] = e
        if (list.length > 800) list.splice(0, list.length - 800)
        net[e.tabId] = list
      }
      return { net }
    }),

  clearNet: (tabId) =>
    set((s) => {
      const net = { ...s.net }
      net[tabId] = []
      return { net }
    }),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelTab: (panelTab) => set({ panelTab, panelOpen: true }),
  setOverrides: (overrides) => set({ overrides }),
  setScripts: (scripts) => set({ scripts }),
  setRules: (rules) => set({ rules }),
  setWorkspaces: (workspaces) => set({ workspaces }),

  pushStatus: (ev) =>
    set((s) => ({ statuses: [...s.statuses.slice(-199), ev] })),

  pushBus: (m) => set((s) => ({ busLog: [...s.busLog.slice(-199), m] })),
  setBusLog: (busLog) => set({ busLog }),

  // Uma função em loop pode disparar muito evento; o log é limitado.
  pushWatch: (e) => set((s) => ({ watchLog: [...s.watchLog.slice(-499), e] })),
  clearWatchLog: () => set({ watchLog: [] }),

  openFile: (f) =>
    set((s) => {
      const existing = s.files.find((x) => x.url === f.url)
      if (existing) return { activeFileUrl: f.url }
      return { files: [...s.files, f], activeFileUrl: f.url }
    }),

  closeFile: (url) =>
    set((s) => {
      const files = s.files.filter((f) => f.url !== url)
      const activeFileUrl =
        s.activeFileUrl === url ? (files[files.length - 1]?.url ?? null) : s.activeFileUrl
      return { files, activeFileUrl }
    }),

  setActiveFile: (activeFileUrl) => set({ activeFileUrl }),

  updateFileText: (url, text) =>
    set((s) => ({
      files: s.files.map((f) => {
        if (f.url !== url) return f
        // Em modo formatado, a digitação altera o texto formatado; o texto no
        // espaço original é reconstruído só ao salvar.
        if (f.pretty) return { ...f, pretty: { ...f.pretty, prettyText: text }, dirty: true }
        return { ...f, text, dirty: true }
      })
    })),

  markFileSaved: (url) =>
    set((s) => ({
      files: s.files.map((f) => (f.url === url ? { ...f, dirty: false } : f))
    })),

  setFilePretty: (url, pretty) =>
    set((s) => ({
      files: s.files.map((f) => (f.url === url ? { ...f, pretty } : f))
    })),

  commitFileText: (url, text) =>
    set((s) => ({
      files: s.files.map((f) => (f.url === url ? { ...f, text } : f))
    }))
}))

export const useActiveTab = () => useApp((s) => s.tabs.find((t) => t.active))
