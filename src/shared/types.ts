export type TabState = {
  id: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  active: boolean
}

export type NetEntry = {
  id: string
  tabId: number
  url: string
  method: string
  resourceType: string
  status?: number
  statusText?: string
  mimeType?: string
  encodedLength?: number
  startTime: number
  endTime?: number
  error?: string
  blocked?: boolean
  overridden?: boolean
  fromCache?: boolean
}

export type OverrideStatus = 'applied' | 'fuzzy' | 'failed'

export type WatchEvent = {
  label: string
  kind: 'call' | 'value'
  tabId: number
  url: string
  at: number
  args?: unknown
  result?: unknown
  error?: unknown
  ms?: number
  async?: boolean
  stack?: string | null
}

export type OverrideStatusEvent = {
  overrideId: string
  url: string
  tabId: number
  kind: 'edit' | 'expose' | 'sri' | 'watch'
  status: OverrideStatus
  message?: string
  label?: string
}

export type BusMessage = {
  topic: string
  data: unknown
  from: { tabId: number; origin: string }
  at: number
}

export type ThrottlePreset = 'none' | 'fast3g' | 'slow3g' | 'offline'

export type Viewport = { x: number; y: number; width: number; height: number }

import type { NetRule, OverrideEntry, UserScript, Workspace } from './schemas'

export interface JwwwApi {
  tabs: {
    list(): Promise<TabState[]>
    create(url?: string): Promise<number>
    close(id: number): Promise<void>
    activate(id: number): Promise<void>
    navigate(id: number, url: string): Promise<void>
    reload(id: number, ignoreCache?: boolean): Promise<void>
    back(id: number): Promise<void>
    forward(id: number): Promise<void>
    setViewport(rect: Viewport): Promise<void>
    openDevTools(id: number): Promise<void>
  }
  net: {
    getBody(tabId: number, requestId: string, url: string): Promise<{ ok: boolean; text?: string; error?: string }>
    /** busca texto auxiliar (source map, fonte original) sem esbarrar em CORS */
    fetchText(url: string): Promise<{ ok: boolean; text?: string; error?: string }>
    clear(tabId: number): Promise<void>
    throttle(tabId: number, preset: ThrottlePreset): Promise<void>
    getDisableCsp(): Promise<boolean>
    setDisableCsp(value: boolean): Promise<void>
  }
  rules: {
    list(): Promise<NetRule[]>
    save(rule: NetRule): Promise<void>
    remove(id: string): Promise<void>
  }
  overrides: {
    list(): Promise<OverrideEntry[]>
    save(entry: OverrideEntry): Promise<void>
    remove(id: string): Promise<void>
  }
  scripts: {
    list(): Promise<UserScript[]>
    save(script: UserScript): Promise<void>
    remove(id: string): Promise<void>
  }
  workspaces: {
    list(): Promise<Workspace[]>
    save(name: string): Promise<Workspace>
    restore(id: string): Promise<void>
    remove(id: string): Promise<void>
    /** devolve o caminho escolhido, ou null se o dev cancelou */
    exportToFile(id: string): Promise<string | null>
    importFromFile(): Promise<Workspace | null>
  }
  bus: {
    emit(topic: string, data: unknown): Promise<void>
    history(): Promise<BusMessage[]>
  }
  on(channel: 'tabs:state', cb: (tabs: TabState[]) => void): () => void
  on(channel: 'net:upsert', cb: (entries: NetEntry[]) => void): () => void
  on(channel: 'net:clear', cb: (tabId: number) => void): () => void
  on(channel: 'override:status', cb: (ev: OverrideStatusEvent) => void): () => void
  on(channel: 'bus:message', cb: (msg: BusMessage) => void): () => void
  on(channel: 'watch:event', cb: (ev: WatchEvent) => void): () => void
  on(
    channel: 'overrides:changed' | 'scripts:changed' | 'rules:changed' | 'workspaces:changed',
    cb: () => void
  ): () => void
  on(channel: 'ui:toggle-panel', cb: () => void): () => void
}
