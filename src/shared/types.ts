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

/**
 * Um valor vindo da página. Espelha o RemoteObject do CDP: primitivos trazem
 * `value`; objetos vêm por referência (`objectId`) com uma prévia, e só são
 * expandidos sob demanda — é o que evita serializar um grafo inteiro a cada log.
 */
export type RemoteValue = {
  type: string
  subtype?: string
  value?: unknown
  description?: string
  objectId?: string
  className?: string
  preview?: {
    overflow: boolean
    properties: Array<{ name: string; type: string; subtype?: string; value?: string }>
  }
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'input' | 'result'

export type ConsoleEntry = {
  id: string
  tabId: number
  level: ConsoleLevel
  args: RemoteValue[]
  at: number
  /** origem no código da página, quando o CDP informa */
  origem?: string
  /** pilha formatada, para erros */
  stack?: string
}

/** Uma função instrumentada pelo mapa de execução. */
export type MapFunction = {
  id: number
  name: string | null
  nodeType: string
  start: number
  end: number
  /** posição no bundle, para localizar no editor */
  line: number
  column: number
  /** posição do identificador — é onde o source map guarda o nome original */
  nameLine: number
  nameColumn: number
}

export type MapCatalogEvent = {
  tabId: number
  /** identifica esta instrumentação; muda a cada recarga */
  fileId: string
  url: string
  /** URL do source map do bundle, quando existe */
  sourceMappingUrl: string | null
  functions: MapFunction[]
}

/**
 * Lote agregado na página:
 * [arquivo, id, chamadas, msPróprio, msTotal, ordemDeEstreia]
 *
 * `próprio` desconta o tempo gasto dentro das funções chamadas; `total` inclui.
 * É a diferença entre "esta função é cara" e "esta função chama coisa cara".
 */
export type MapCountsEvent = {
  tabId: number
  lote: Array<[string, number, number, number, number, number]>
  /** ms que o embrulho da instrumentação custa por chamada, medido na página */
  custoPorChamada?: number | null
}

export type OverrideStatusEvent = {
  overrideId: string
  url: string
  tabId: number
  kind: 'edit' | 'expose' | 'sri' | 'watch' | 'map'
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
    /** esconde a página para diálogos da UI não ficarem atrás dela */
    setPageVisible(visible: boolean): Promise<void>
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
    setAllEnabled(enabled: boolean): Promise<void>
    copy(id: string): Promise<{ ok: boolean; error?: string }>
    paste(): Promise<{ ok: boolean; url?: string; error?: string }>
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
  console: {
    /** avalia no mundo principal da página, como o console do DevTools */
    evaluate(
      tabId: number,
      expression: string
    ): Promise<{ ok: boolean; value?: RemoteValue; error?: string }>
    /** expande um objeto sob demanda */
    getProperties(
      tabId: number,
      objectId: string
    ): Promise<{ ok: boolean; properties?: Array<{ name: string; value: RemoteValue }>; error?: string }>
    clear(tabId: number): Promise<void>
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
  on(channel: 'console:entries', cb: (entries: ConsoleEntry[]) => void): () => void
  on(channel: 'console:clear', cb: (tabId: number) => void): () => void
  on(channel: 'map:catalog', cb: (ev: MapCatalogEvent) => void): () => void
  on(channel: 'map:counts', cb: (ev: MapCountsEvent) => void): () => void
  on(
    channel: 'overrides:changed' | 'scripts:changed' | 'rules:changed' | 'workspaces:changed',
    cb: () => void
  ): () => void
  on(channel: 'ui:toggle-panel' | 'ui:focus-url', cb: () => void): () => void
}
