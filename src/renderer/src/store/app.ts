import { create } from 'zustand'
import type {
  BusMessage,
  ConsoleEntry,
  MapCatalogEvent,
  MapCountsEvent,
  NetEntry,
  OverrideStatusEvent,
  TabState,
  WatchEvent
} from '@shared/types'
import type { NetRule, OverrideEntry, UserScript, Workspace } from '@shared/schemas'

import type { PrettyAnchor } from '@/lib/prettify'
import type { LoadedSourceMap } from '@/lib/sourcemap'

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
  /**
   * Source map do bundle, quando o site publica um. `undefined` = ainda não
   * procuramos; `null` = procuramos e não há.
   */
  sourceMap?: LoadedSourceMap | null
  /** índice em sourceMap.contents sendo visualizado; null = o bundle */
  viewingSource?: number | null
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
  /**
   * Último status de cada override e de cada URL.
   *
   * `statuses` é uma fila curta que serve de histórico; o estado atual não pode
   * viver nela, senão uma página com muitos overrides empurra para fora
   * justamente o aviso de que um patch degradou — que é o dado mais importante
   * do sistema. Aqui um override ocupa uma posição só, e ela não some.
   */
  statusPorOverride: Record<string, OverrideStatusEvent>
  statusPorUrl: Record<string, OverrideStatusEvent>
  busLog: BusMessage[]
  /** console da página, por aba */
  consoleLog: Record<number, ConsoleEntry[]>
  watchLog: WatchEvent[]
  /** catálogo de funções instrumentadas, por fileId (uma instrumentação) */
  mapCatalogs: Record<string, MapCatalogEvent>
  /** contagens: fileId -> id da função -> tempos e ordem de estreia */
  mapCounts: Record<
    string,
    Record<number, { calls: number; proprio: number; total: number; ordem: number }>
  >
  /** custo em ms de uma chamada instrumentada, medido na própria página */
  custoPorChamada: number | null
  files: EditorFile[]
  activeFileUrl: string | null
  /**
   * Pedido de "pule para esta linha" feito por outro painel (o console, ao
   * clicar na origem de uma mensagem). O editor consome e limpa — é o que liga
   * "vi o erro" a "vou corrigir" sem o dev procurar o arquivo na mão.
   */
  revelar: { url: string; linha: number } | null

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
  addConsoleEntries: (entries: ConsoleEntry[]) => void
  /** entradas criadas na própria UI (o que você digitou e o resultado) */
  pushConsoleLocal: (tabId: number, entry: ConsoleEntry) => void
  clearConsoleLog: (tabId: number) => void
  pushWatch: (e: WatchEvent) => void
  clearWatchLog: () => void
  setMapCatalog: (ev: MapCatalogEvent) => void
  addMapCounts: (ev: MapCountsEvent) => void
  clearMapCounts: (fileId: string) => void
  clearMapCountsForTab: (tabId: number) => void
  pedirRevelar: (url: string, linha: number) => void
  revelado: () => void
  openFile: (f: EditorFile) => void
  closeFile: (url: string) => void
  setActiveFile: (url: string) => void
  updateFileText: (url: string, text: string) => void
  markFileSaved: (url: string) => void
  setFilePretty: (url: string, pretty: EditorFile['pretty']) => void
  commitFileText: (url: string, text: string) => void
  setFileSourceMap: (url: string, sourceMap: LoadedSourceMap | null) => void
  setViewingSource: (url: string, index: number | null) => void
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
  statusPorOverride: {},
  statusPorUrl: {},
  busLog: [],
  consoleLog: {},
  watchLog: [],
  mapCatalogs: {},
  mapCounts: {},
  custoPorChamada: null,
  files: [],
  activeFileUrl: null,
  revelar: null,

  /**
   * Aba fechada tem que levar embora o log de rede e os catálogos do mapa dela.
   * Sem isso, uma sessão longa acumula centenas de entradas e catálogos de
   * milhares de funções que ninguém mais consegue ver.
   */
  setTabs: (tabs) =>
    set((s) => {
      const vivas = new Set(tabs.map((t) => t.id))
      const sobrou =
        Object.keys(s.net).some((id) => !vivas.has(Number(id))) ||
        Object.keys(s.consoleLog).some((id) => !vivas.has(Number(id)))
      const catalogosMortos = Object.entries(s.mapCatalogs).filter(([, c]) => !vivas.has(c.tabId))
      if (!sobrou && catalogosMortos.length === 0) return { tabs }

      const net = Object.fromEntries(
        Object.entries(s.net).filter(([id]) => vivas.has(Number(id)))
      )
      const consoleLog = Object.fromEntries(
        Object.entries(s.consoleLog).filter(([id]) => vivas.has(Number(id)))
      )
      const mapCatalogs = Object.fromEntries(
        Object.entries(s.mapCatalogs).filter(([, c]) => vivas.has(c.tabId))
      )
      const mapCounts = Object.fromEntries(
        Object.entries(s.mapCounts).filter(([fileId]) => mapCatalogs[fileId] !== undefined)
      )
      return { tabs, net, consoleLog, mapCatalogs, mapCounts }
    }),

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
  setOverrides: (overrides) =>
    set((s) => {
      // Override removido não pode deixar para trás um status órfão que ainda
      // pinta o arquivo de vermelho na árvore.
      const vivos = new Set(overrides.map((o) => o.id))
      const statusPorOverride = Object.fromEntries(
        Object.entries(s.statusPorOverride).filter(([id]) => vivos.has(id))
      )
      const statusPorUrl = Object.fromEntries(
        Object.entries(s.statusPorUrl).filter(([, ev]) => vivos.has(ev.overrideId))
      )
      return { overrides, statusPorOverride, statusPorUrl }
    }),
  setScripts: (scripts) => set({ scripts }),
  setRules: (rules) => set({ rules }),
  setWorkspaces: (workspaces) => set({ workspaces }),

  pushStatus: (ev) =>
    set((s) => ({
      statuses: [...s.statuses.slice(-199), ev],
      statusPorOverride: { ...s.statusPorOverride, [ev.overrideId]: ev },
      statusPorUrl: { ...s.statusPorUrl, [ev.url]: ev }
    })),

  pushBus: (m) => set((s) => ({ busLog: [...s.busLog.slice(-199), m] })),
  setBusLog: (busLog) => set({ busLog }),

  addConsoleEntries: (entries) =>
    set((s) => {
      const consoleLog = { ...s.consoleLog }
      for (const e of entries) {
        // uma página pode logar aos milhares: o histórico é limitado
        consoleLog[e.tabId] = [...(consoleLog[e.tabId] ?? []).slice(-999), e]
      }
      return { consoleLog }
    }),

  pushConsoleLocal: (tabId, entry) =>
    set((s) => ({
      consoleLog: { ...s.consoleLog, [tabId]: [...(s.consoleLog[tabId] ?? []).slice(-999), entry] }
    })),

  clearConsoleLog: (tabId) => set((s) => ({ consoleLog: { ...s.consoleLog, [tabId]: [] } })),

  // Uma função em loop pode disparar muito evento; o log é limitado.
  pushWatch: (e) => set((s) => ({ watchLog: [...s.watchLog.slice(-499), e] })),
  clearWatchLog: () => set({ watchLog: [] }),

  /**
   * O fileId vem do conteúdo do arquivo. Se ele já é conhecido, é a mesma
   * instrumentação sendo reentregue (um `fetch` da página, por exemplo) e as
   * contagens acumuladas continuam valendo. Se mudou, o arquivo mudou: a
   * instrumentação anterior daquele URL é descartada.
   */
  setMapCatalog: (ev) =>
    set((s) => {
      if (s.mapCatalogs[ev.fileId]) return {}
      const catalogos = Object.fromEntries(
        Object.entries(s.mapCatalogs).filter(([, c]) => c.url !== ev.url)
      )
      const contagens = Object.fromEntries(
        Object.entries(s.mapCounts).filter(([id]) => catalogos[id] !== undefined)
      )
      return {
        mapCatalogs: { ...catalogos, [ev.fileId]: ev },
        mapCounts: { ...contagens, [ev.fileId]: {} }
      }
    }),

  /** Nova navegação começa a contagem do zero. */
  clearMapCountsForTab: (tabId) =>
    set((s) => {
      const contagens = { ...s.mapCounts }
      for (const [fileId, catalogo] of Object.entries(s.mapCatalogs)) {
        if (catalogo.tabId === tabId) contagens[fileId] = {}
      }
      return { mapCounts: contagens }
    }),

  addMapCounts: (ev) =>
    set((s) => {
      const porArquivo = { ...s.mapCounts }
      const custoPorChamada =
        typeof ev.custoPorChamada === 'number' ? ev.custoPorChamada : s.custoPorChamada
      for (const [fileId, id, calls, proprio, total, ordem] of ev.lote) {
        const atual = { ...(porArquivo[fileId] ?? {}) }
        const anterior = atual[id]
        atual[id] = anterior
          ? {
              calls: anterior.calls + calls,
              proprio: anterior.proprio + proprio,
              total: anterior.total + total,
              // a estreia é a primeira que vimos, não a do lote mais recente
              ordem: Math.min(anterior.ordem, ordem)
            }
          : { calls, proprio, total, ordem }
        porArquivo[fileId] = atual
      }
      return { mapCounts: porArquivo, custoPorChamada }
    }),

  clearMapCounts: (fileId) => set((s) => ({ mapCounts: { ...s.mapCounts, [fileId]: {} } })),

  pedirRevelar: (url, linha) => set({ revelar: { url, linha } }),
  revelado: () => set({ revelar: null }),
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
    })),

  setFileSourceMap: (url, sourceMap) =>
    set((s) => ({
      files: s.files.map((f) => (f.url === url ? { ...f, sourceMap } : f))
    })),

  setViewingSource: (url, viewingSource) =>
    set((s) => ({
      files: s.files.map((f) => (f.url === url ? { ...f, viewingSource } : f))
    }))
}))

export const useActiveTab = () => useApp((s) => s.tabs.find((t) => t.active))
