import { app, BrowserWindow, Menu, session, type WebContents } from 'electron'
import { join } from 'path'
import { NetRuleSchema, OverrideEntrySchema, UserScriptSchema, WorkspaceSchema } from '@shared/schemas'
import type { NetRule, OverrideEntry, UserScript, Workspace } from '@shared/schemas'
import { ListStore } from './store'
import { OverrideEngine } from './overrides'
import { buildUserScriptBundle } from './userscripts'
import { WATCH_RUNTIME } from './watch'
import { MAP_RUNTIME } from './mapping'
import UI_TOOLKIT from './uikit.js?raw'
import { TabDebugger } from './cdp'
import { TabManager } from './tabs'
import { registerIpc } from './ipc'

let win: BrowserWindow | null = null
let tabManager: TabManager | null = null

// Permite inspecionar/automatizar a própria UI do JWWW de fora (testes, scripts).
if (process.env['JWWW_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['JWWW_DEBUG_PORT'])
}

function uiSend(channel: string, payload?: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow() {
  const overridesStore = new ListStore<OverrideEntry>('overrides', OverrideEntrySchema)
  const scriptsStore = new ListStore<UserScript>('userscripts', UserScriptSchema)
  const rulesStore = new ListStore<NetRule>('netrules', NetRuleSchema)
  const workspacesStore = new ListStore<Workspace>('workspaces', WorkspaceSchema)
  const engine = new OverrideEngine(() => overridesStore.all())
  let disableCsp = false

  /**
   * Tudo que é injetado antes dos scripts da página: o runtime de observação
   * (só quando há algum watch ativo) e os userscripts.
   */
  const buildInjection = (): string | null => {
    const ativos = overridesStore.all().filter((o) => o.enabled)
    const precisaWatch = ativos.some((o) => o.kind === 'watch')
    const precisaMap = ativos.some((o) => o.kind === 'map')
    const partes = [
      precisaWatch ? WATCH_RUNTIME : null,
      precisaMap ? MAP_RUNTIME : null,
      // O toolkit vai sempre: userscript nenhum precisa "ligar" nada, e dá para
      // montar UI direto do console de qualquer página.
      UI_TOOLKIT,
      buildUserScriptBundle(scriptsStore.all())
    ]
    const juntas = partes.filter(Boolean).join('\n')
    return juntas.length > 0 ? juntas : null
  }
  let bundle = buildInjection()

  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/ui.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  // Sites tratam UA de Electron de forma hostil; nos apresentamos como Chrome.
  const ses = session.fromPartition('persist:jwww')
  ses.setUserAgent(
    ses
      .getUserAgent()
      .replace(/\sjwww\/[^\s]+/i, '')
      .replace(/\sElectron\/[^\s]+/, '')
  )

  const makeDebugger = (wc: WebContents, tabId: number) =>
    new TabDebugger(wc, tabId, {
      overrides: engine,
      getRules: () => rulesStore.all(),
      getBundle: () => bundle,
      getDisableCsp: () => disableCsp,
      emitNet: (_tabId, entries) => uiSend('net:upsert', entries),
      emitNetClear: (tabId) => uiSend('net:clear', tabId),
      emitOverrideStatus: (ev) => uiSend('override:status', ev),
      emitMapCatalog: (ev) => uiSend('map:catalog', ev),
      emitConsole: (entries) => uiSend('console:entries', entries),
      emitConsoleClear: (tabId) => uiSend('console:clear', tabId)
    })

  tabManager = new TabManager(win, makeDebugger)

  const refreshScripts = () => {
    bundle = buildInjection()
    for (const t of tabManager!.allTabs()) t.dbg.refreshUserScripts()
  }

  registerIpc({
    tabs: tabManager,
    ui: () => win!.webContents,
    overridesStore,
    scriptsStore,
    rulesStore,
    workspacesStore,
    refreshScripts,
    getDisableCsp: () => disableCsp,
    setDisableCsp: (v) => {
      disableCsp = v
    }
  })

  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('console-message', (...args: any[]) => {
    const e = args[0]
    if (e && typeof e === 'object' && 'message' in e) {
      console.log(`[ui:${e.level}] ${e.message}`)
    } else {
      console.log(`[ui:${args[1]}] ${args[2]} (${args[4]}:${args[3]})`)
    }
  })
  win.once('ready-to-show', () => win!.show())
  win.webContents.once('did-finish-load', () => {
    if (tabManager!.list().length === 0) {
      tabManager!.create(process.env['JWWW_START_URL'] ?? 'https://example.com')
    }
  })
  win.on('closed', () => {
    win = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  buildMenu()
}

function active() {
  return tabManager?.activeId != null ? tabManager.get(tabManager.activeId) : undefined
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'JWWW',
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]
    },
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Nova aba', accelerator: 'CmdOrCtrl+T', click: () => tabManager?.create() },
        {
          label: 'Fechar aba',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (tabManager?.activeId != null) tabManager.close(tabManager.activeId)
          }
        }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Navegação',
      submenu: [
        {
          label: 'Ir para o endereço',
          accelerator: 'CmdOrCtrl+L',
          click: () => uiSend('ui:focus-url')
        },
        { type: 'separator' },
        {
          label: 'Recarregar',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const t = active()
            if (t) tabManager!.reload(t.id)
          }
        },
        {
          label: 'Recarregar sem cache',
          accelerator: 'Shift+CmdOrCtrl+R',
          click: () => {
            const t = active()
            if (t) tabManager!.reload(t.id, true)
          }
        },
        {
          label: 'Voltar',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            const t = active()
            if (t) tabManager!.back(t.id)
          }
        },
        {
          label: 'Avançar',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            const t = active()
            if (t) tabManager!.forward(t.id)
          }
        }
      ]
    },
    {
      label: 'Dev',
      submenu: [
        {
          label: 'Painel dev',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => uiSend('ui:toggle-panel')
        },
        {
          label: 'DevTools da página',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => {
            const t = active()
            if (t) tabManager!.openDevTools(t.id)
          }
        },
        {
          label: 'DevTools da UI',
          click: () => win?.webContents.openDevTools({ mode: 'detach' })
        }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Duas instâncias compartilhariam os mesmos JSONs de override/script e uma
// sobrescreveria o estado da outra.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// No macOS o app segue vivo sem janela e volta pelo dock (é o que o handler
// 'activate' acima espera); nos demais sistemas, fechar a janela encerra.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
