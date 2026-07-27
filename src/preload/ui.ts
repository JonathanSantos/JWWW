import { contextBridge, ipcRenderer } from 'electron'

const EVENT_CHANNELS = new Set([
  'tabs:state',
  'net:upsert',
  'net:clear',
  'override:status',
  'bus:message',
  'watch:event',
  'overrides:changed',
  'scripts:changed',
  'rules:changed',
  'workspaces:changed',
  'ui:toggle-panel'
])

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  tabs: {
    list: () => invoke('tabs:list'),
    create: (url?: string) => invoke('tabs:create', url),
    close: (id: number) => invoke('tabs:close', id),
    activate: (id: number) => invoke('tabs:activate', id),
    navigate: (id: number, url: string) => invoke('tabs:navigate', id, url),
    reload: (id: number, ignoreCache?: boolean) => invoke('tabs:reload', id, ignoreCache),
    back: (id: number) => invoke('tabs:back', id),
    forward: (id: number) => invoke('tabs:forward', id),
    setViewport: (rect: unknown) => invoke('tabs:viewport', rect),
    openDevTools: (id: number) => invoke('tabs:devtools', id)
  },
  net: {
    getBody: (tabId: number, requestId: string, url: string) => invoke('net:getBody', { tabId, requestId, url }),
    clear: (tabId: number) => invoke('net:clearLog', tabId),
    throttle: (tabId: number, preset: string) => invoke('net:throttle', { tabId, preset }),
    getDisableCsp: () => invoke('net:getDisableCsp'),
    setDisableCsp: (v: boolean) => invoke('net:setDisableCsp', v)
  },
  rules: {
    list: () => invoke('rules:list'),
    save: (rule: unknown) => invoke('rules:save', rule),
    remove: (id: string) => invoke('rules:remove', id)
  },
  overrides: {
    list: () => invoke('overrides:list'),
    save: (entry: unknown) => invoke('overrides:save', entry),
    remove: (id: string) => invoke('overrides:remove', id)
  },
  scripts: {
    list: () => invoke('scripts:list'),
    save: (script: unknown) => invoke('scripts:save', script),
    remove: (id: string) => invoke('scripts:remove', id)
  },
  workspaces: {
    list: () => invoke('workspaces:list'),
    save: (name: string) => invoke('workspaces:save', name),
    restore: (id: string) => invoke('workspaces:restore', id),
    remove: (id: string) => invoke('workspaces:remove', id),
    exportToFile: (id: string) => invoke('workspaces:export', id),
    importFromFile: () => invoke('workspaces:import')
  },
  bus: {
    emit: (topic: string, data: unknown) => invoke('bus:emit', { topic, data }),
    history: () => invoke('bus:history')
  },
  on: (channel: string, cb: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.has(channel)) throw new Error('canal desconhecido: ' + channel)
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})
