import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { z } from 'zod'
import {
  BusEmitSchema,
  NetRuleSchema,
  OverrideEntrySchema,
  UserScriptSchema,
  WorkspaceFileSchema,
  WorkspaceSchema,
  type NetRule,
  type OverrideEntry,
  type UserScript,
  type Workspace
} from '@shared/schemas'
import type { BusMessage, ThrottlePreset, Viewport } from '@shared/types'
import type { ListStore } from './store'
import type { TabManager } from './tabs'

const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

const MAX_BODY_BYTES = 8 * 1024 * 1024

export type IpcContext = {
  tabs: TabManager
  ui: () => WebContents
  overridesStore: ListStore<OverrideEntry>
  scriptsStore: ListStore<UserScript>
  rulesStore: ListStore<NetRule>
  workspacesStore: ListStore<Workspace>
  refreshScripts: () => void
  getDisableCsp: () => boolean
  setDisableCsp: (v: boolean) => void
}

const busHistory: BusMessage[] = []

export function registerIpc(ctx: IpcContext) {
  const uiSend = (channel: string, payload?: unknown) => {
    const ui = ctx.ui()
    if (!ui.isDestroyed()) ui.send(channel, payload)
  }

  // Só a janela da UI pode usar os canais privilegiados.
  const handleUi = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (e.sender !== ctx.ui()) throw new Error(`canal ${channel}: sender não autorizado`)
      return fn(...args)
    })
  }

  // --- abas ---
  handleUi('tabs:list', () => ctx.tabs.list())
  handleUi('tabs:create', (url?: unknown) => ctx.tabs.create(z.string().optional().parse(url) ?? 'about:blank'))
  handleUi('tabs:close', (id: unknown) => ctx.tabs.close(z.number().parse(id)))
  handleUi('tabs:activate', (id: unknown) => ctx.tabs.activate(z.number().parse(id)))
  handleUi('tabs:navigate', (id: unknown, url: unknown) =>
    ctx.tabs.navigate(z.number().parse(id), z.string().parse(url))
  )
  handleUi('tabs:reload', (id: unknown, ignoreCache?: unknown) =>
    ctx.tabs.reload(z.number().parse(id), z.boolean().optional().parse(ignoreCache) ?? false)
  )
  handleUi('tabs:back', (id: unknown) => ctx.tabs.back(z.number().parse(id)))
  handleUi('tabs:forward', (id: unknown) => ctx.tabs.forward(z.number().parse(id)))
  handleUi('tabs:devtools', (id: unknown) => ctx.tabs.openDevTools(z.number().parse(id)))
  handleUi('tabs:viewport', (rect: unknown) => ctx.tabs.setViewport(ViewportSchema.parse(rect) as Viewport))
  handleUi('tabs:pageVisible', (v: unknown) => ctx.tabs.setPageVisible(z.boolean().parse(v)))

  // --- rede ---
  handleUi('net:getBody', async (payload: unknown) => {
    const { tabId, requestId, url } = z
      .object({ tabId: z.number(), requestId: z.string(), url: z.string() })
      .parse(payload)
    const tab = ctx.tabs.get(tabId)
    if (tab?.dbg.attached && requestId) {
      try {
        const text = await tab.dbg.getBody(requestId)
        if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'Arquivo muito grande para o editor (>8MB).' }
        return { ok: true, text }
      } catch {
        // corpo já saiu do buffer do CDP — cai no refetch abaixo
      }
    }
    try {
      const res = await session.fromPartition('persist:jwww').fetch(url)
      const text = await res.text()
      if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'Arquivo muito grande para o editor (>8MB).' }
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  /**
   * Busca texto auxiliar do mesmo contexto de navegação (source maps e fontes
   * originais). Vai pelo main porque a UI tem outra origem e sofreria CORS.
   */
  handleUi('net:fetchText', async (url: unknown) => {
    const alvo = z.string().url().parse(url)
    try {
      const res = await session.fromPartition('persist:jwww').fetch(alvo)
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      const text = await res.text()
      if (text.length > MAX_BODY_BYTES) return { ok: false as const, error: 'Arquivo muito grande (>8MB).' }
      return { ok: true as const, text }
    } catch (err) {
      return { ok: false as const, error: String(err) }
    }
  })

  handleUi('net:clearLog', (tabId: unknown) => {
    ctx.tabs.get(z.number().parse(tabId))?.dbg.clearLog()
  })

  // Sessão-only de propósito: desligar CSP é um downgrade de segurança e não
  // deve sobreviver a um restart sem o dev pedir de novo.
  handleUi('net:getDisableCsp', () => ctx.getDisableCsp())
  handleUi('net:setDisableCsp', (v: unknown) => ctx.setDisableCsp(z.boolean().parse(v)))

  handleUi('net:throttle', async (payload: unknown) => {
    const { tabId, preset } = z
      .object({ tabId: z.number(), preset: z.enum(['none', 'fast3g', 'slow3g', 'offline']) })
      .parse(payload)
    await ctx.tabs.get(tabId)?.dbg.setThrottle(preset as ThrottlePreset)
  })

  // --- console da página ---
  handleUi('console:evaluate', async (payload: unknown) => {
    const { tabId, expression } = z
      .object({ tabId: z.number(), expression: z.string().max(100_000) })
      .parse(payload)
    const tab = ctx.tabs.get(tabId)
    if (!tab?.dbg.attached) return { ok: false as const, error: 'aba sem depurador anexado' }
    return tab.dbg.evaluate(expression)
  })

  handleUi('console:getProperties', async (payload: unknown) => {
    const { tabId, objectId } = z.object({ tabId: z.number(), objectId: z.string() }).parse(payload)
    const tab = ctx.tabs.get(tabId)
    if (!tab?.dbg.attached) return { ok: false as const, error: 'aba sem depurador anexado' }
    return tab.dbg.getProperties(objectId)
  })

  handleUi('console:clear', (tabId: unknown) => {
    ctx.tabs.get(z.number().parse(tabId))?.dbg.clearConsole()
  })

  // --- regras de rede ---
  handleUi('rules:list', () => ctx.rulesStore.all())
  handleUi('rules:save', (rule: unknown) => {
    ctx.rulesStore.upsert(NetRuleSchema.parse(rule))
    uiSend('rules:changed')
  })
  handleUi('rules:remove', (id: unknown) => {
    ctx.rulesStore.remove(z.string().parse(id))
    uiSend('rules:changed')
  })

  // --- overrides ---
  handleUi('overrides:list', () => ctx.overridesStore.all())
  handleUi('overrides:save', (entry: unknown) => {
    ctx.overridesStore.upsert(OverrideEntrySchema.parse(entry))
    // Um override de observação decide se o runtime é injetado nas páginas.
    ctx.refreshScripts()
    uiSend('overrides:changed')
  })
  handleUi('overrides:remove', (id: unknown) => {
    ctx.overridesStore.remove(z.string().parse(id))
    ctx.refreshScripts()
    uiSend('overrides:changed')
  })

  /**
   * Interruptor geral. Quando algo quebra, a primeira pergunta é "sou eu ou é o
   * site?" — e responder isso desligando override por override não é resposta.
   */
  handleUi('overrides:setAllEnabled', (enabled: unknown) => {
    const valor = z.boolean().parse(enabled)
    for (const o of ctx.overridesStore.all()) {
      if (o.enabled !== valor) ctx.overridesStore.upsert({ ...o, enabled: valor })
    }
    ctx.refreshScripts()
    uiSend('overrides:changed')
  })

  /** Copiar/colar leva o override inteiro — inclusive o original que ele ancora. */
  handleUi('overrides:copy', (id: unknown) => {
    const o = ctx.overridesStore.all().find((x) => x.id === z.string().parse(id))
    if (!o) return { ok: false, error: 'override não encontrado' }
    clipboard.writeText(JSON.stringify(o, null, 2))
    return { ok: true }
  })

  handleUi('overrides:paste', () => {
    const texto = clipboard.readText().trim()
    if (!texto) return { ok: false, error: 'a área de transferência está vazia' }
    try {
      const bruto = OverrideEntrySchema.parse(JSON.parse(texto))
      // Id novo: colar duas vezes cria dois overrides, não sobrescreve o do outro.
      const entry = { ...bruto, id: crypto.randomUUID(), updatedAt: Date.now() }
      ctx.overridesStore.upsert(entry)
      ctx.refreshScripts()
      uiSend('overrides:changed')
      return { ok: true, url: entry.url }
    } catch (err) {
      return { ok: false, error: 'o conteúdo copiado não é um override do JWWW' }
    }
  })

  // --- userscripts ---
  handleUi('scripts:list', () => ctx.scriptsStore.all())
  handleUi('scripts:save', (script: unknown) => {
    ctx.scriptsStore.upsert(UserScriptSchema.parse(script))
    ctx.refreshScripts()
    uiSend('scripts:changed')
  })
  handleUi('scripts:remove', (id: unknown) => {
    ctx.scriptsStore.remove(z.string().parse(id))
    ctx.refreshScripts()
    uiSend('scripts:changed')
  })

  // --- sessões (snapshot de overrides + scripts + regras) ---
  const snapshot = (name: string): Workspace => ({
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    overrides: ctx.overridesStore.all(),
    scripts: ctx.scriptsStore.all(),
    rules: ctx.rulesStore.all()
  })

  const restore = (ws: Workspace) => {
    ctx.overridesStore.replaceAll(ws.overrides)
    ctx.scriptsStore.replaceAll(ws.scripts)
    ctx.rulesStore.replaceAll(ws.rules)
    ctx.refreshScripts()
    uiSend('overrides:changed')
    uiSend('scripts:changed')
    uiSend('rules:changed')
  }

  handleUi('workspaces:list', () => ctx.workspacesStore.all())

  handleUi('workspaces:save', (name: unknown) => {
    const ws = snapshot(z.string().min(1).parse(name))
    ctx.workspacesStore.upsert(ws)
    uiSend('workspaces:changed')
    return ws
  })

  handleUi('workspaces:restore', (id: unknown) => {
    const ws = ctx.workspacesStore.all().find((w) => w.id === z.string().parse(id))
    if (!ws) throw new Error('sessão não encontrada')
    restore(ws)
  })

  handleUi('workspaces:remove', (id: unknown) => {
    ctx.workspacesStore.remove(z.string().parse(id))
    uiSend('workspaces:changed')
  })

  handleUi('workspaces:export', async (id: unknown) => {
    const parsedId = z.string().parse(id)
    const ws = ctx.workspacesStore.all().find((w) => w.id === parsedId)
    if (!ws) throw new Error('sessão não encontrada')
    const win = BrowserWindow.fromWebContents(ctx.ui())
    const safeName = ws.name.replace(/[^\w.-]+/g, '-').toLowerCase()
    const res = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: `${safeName}.jwww.json`,
          filters: [{ name: 'Sessão JWWW', extensions: ['json'] }]
        })
      : await dialog.showSaveDialog({ defaultPath: `${safeName}.jwww.json` })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, JSON.stringify({ jwww: 1, workspace: ws }, null, 2), 'utf8')
    return res.filePath
  })

  handleUi('workspaces:import', async () => {
    const win = BrowserWindow.fromWebContents(ctx.ui())
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: 'Sessão JWWW', extensions: ['json'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null

    const raw = JSON.parse(await readFile(res.filePaths[0], 'utf8'))
    // Ids novos: importar duas vezes não deve sobrescrever a sessão anterior.
    const parsed = WorkspaceFileSchema.parse(raw)
    const ws: Workspace = { ...parsed.workspace, id: crypto.randomUUID() }
    ctx.workspacesStore.upsert(ws)
    uiSend('workspaces:changed')
    return ws
  })

  // --- bus entre abas (independente de domínio, via IPC) ---
  const broadcast = (topic: string, data: unknown, from: BusMessage['from']) => {
    const msg: BusMessage = { topic, data, from, at: Date.now() }
    if (process.env.JWWW_DEBUG) console.log('[bus]', topic, JSON.stringify(data), 'de', from.origin)
    busHistory.push(msg)
    if (busHistory.length > 300) busHistory.splice(0, busHistory.length - 300)
    for (const t of ctx.tabs.allTabs()) {
      const wc = t.view.webContents
      if (!wc.isDestroyed()) wc.send('jwww:bus:message', msg)
    }
    uiSend('bus:message', msg)
  }

  handleUi('bus:emit', (payload: unknown) => {
    const { topic, data } = BusEmitSchema.parse(payload)
    broadcast(topic, data, { tabId: -1, origin: 'jwww://ui' })
  })
  handleUi('bus:history', () => busHistory)

  // --- eventos de observação vindos do runtime injetado nas páginas ---
  const WatchEventSchema = z.object({
    label: z.string().max(200),
    kind: z.enum(['call', 'value']),
    at: z.number(),
    url: z.string(),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
    ms: z.number().optional(),
    async: z.boolean().optional(),
    stack: z.string().nullable().optional()
  })

  ipcMain.on('jwww:watch', (e, payload: unknown) => {
    if (!ctx.tabs.isPageWebContents(e.sender)) return
    const parsed = WatchEventSchema.safeParse(payload)
    if (!parsed.success) return
    uiSend('watch:event', { ...parsed.data, tabId: e.sender.id })
  })

  const MapCountsSchema = z.object({
    lote: z
      .array(
        z.tuple([z.string().max(64), z.number(), z.number(), z.number(), z.number(), z.number()])
      )
      .max(20_000),
    /** ms que o embrulho custa por chamada, medido na própria página */
    custoPorChamada: z.number().nonnegative().nullable().optional()
  })

  ipcMain.on('jwww:map', (e, payload: unknown) => {
    if (!ctx.tabs.isPageWebContents(e.sender)) return
    const parsed = MapCountsSchema.safeParse(payload)
    if (!parsed.success) return
    uiSend('map:counts', { ...parsed.data, tabId: e.sender.id })
  })

  // Páginas emitem pelo preload delas (fire-and-forget).
  ipcMain.on('jwww:bus:emit', (e, payload: unknown) => {
    if (!ctx.tabs.isPageWebContents(e.sender)) return
    const parsed = BusEmitSchema.safeParse(payload)
    if (!parsed.success) return
    let origin = 'null'
    try {
      origin = new URL(e.sender.getURL()).origin
    } catch {}
    broadcast(parsed.data.topic, parsed.data.data, { tabId: e.sender.id, origin })
  })
}
