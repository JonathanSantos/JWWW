import { contextBridge, ipcRenderer } from 'electron'

/**
 * API injetada em TODAS as páginas: window.jwww
 * O bus atravessa abas e domínios via IPC do Electron — nenhuma restrição
 * de same-origin se aplica, porque a mensagem nunca passa pela web.
 */
type BusHandler = (msg: { topic: string; data: unknown; from: { tabId: number; origin: string }; at: number }) => void

const listeners = new Map<string, Set<BusHandler>>()

ipcRenderer.on('jwww:bus:message', (_e, msg) => {
  for (const topic of [msg.topic, '*']) {
    const set = listeners.get(topic)
    if (!set) continue
    for (const fn of set) {
      try {
        fn(msg)
      } catch (err) {
        console.error('[jwww.bus] handler:', err)
      }
    }
  }
})

contextBridge.exposeInMainWorld('jwww', {
  version: '0.1.0',
  /** Interno: usado pelo runtime de observação injetado nos arquivos com watch. */
  _watch(event: unknown) {
    ipcRenderer.send('jwww:watch', event)
  },
  bus: {
    emit(topic: string, data?: unknown) {
      if (typeof topic !== 'string' || !topic) throw new Error('jwww.bus.emit(topic, data): topic deve ser string')
      ipcRenderer.send('jwww:bus:emit', { topic, data })
    },
    /** on(topic, cb) — use topic '*' para ouvir tudo. Retorna unsubscribe. */
    on(topic: string, cb: BusHandler) {
      if (typeof topic !== 'string' || typeof cb !== 'function') {
        throw new Error('jwww.bus.on(topic, cb)')
      }
      let set = listeners.get(topic)
      if (!set) {
        set = new Set()
        listeners.set(topic, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
      }
    }
  }
})
