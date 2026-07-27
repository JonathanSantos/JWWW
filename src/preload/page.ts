import { contextBridge, ipcRenderer } from 'electron'

/**
 * Ponte interna com o processo main. É só transporte — a API amigável
 * (`window.jwww`) é construída pelo toolkit, no mundo da página.
 *
 * O motivo é concreto: objetos expostos pelo contextBridge são congelados e a
 * propriedade fica não-configurável, então nada consegue estender `jwww` depois.
 * Deixando a montagem para o toolkit, o namespace continua sendo nosso e pode
 * crescer (ui, estado compartilhado, rpc) sem esbarrar nisso.
 */
type MensagemDoBus = {
  topic: string
  data: unknown
  from: { tabId: number; origin: string }
  at: number
}

const ouvintes: Array<(msg: MensagemDoBus) => void> = []

ipcRenderer.on('jwww:bus:message', (_e, msg: MensagemDoBus) => {
  for (const fn of ouvintes.slice()) {
    try {
      fn(msg)
    } catch (err) {
      console.error('[jwww.bus] ouvinte falhou:', err)
    }
  }
})

contextBridge.exposeInMainWorld('__jwwwBridge', {
  version: '0.1.0',

  emitBus(topic: string, data: unknown) {
    if (typeof topic !== 'string' || !topic) throw new Error('topic deve ser uma string não vazia')
    ipcRenderer.send('jwww:bus:emit', { topic, data })
  },

  onBus(cb: (msg: MensagemDoBus) => void) {
    if (typeof cb !== 'function') throw new Error('onBus(cb): cb deve ser função')
    ouvintes.push(cb)
    return () => {
      const i = ouvintes.indexOf(cb)
      if (i !== -1) ouvintes.splice(i, 1)
    }
  },

  /** runtime de observação */
  watch(evento: unknown) {
    ipcRenderer.send('jwww:watch', evento)
  },

  /** lotes do mapa de execução */
  map(evento: unknown) {
    ipcRenderer.send('jwww:map', evento)
  }
})
