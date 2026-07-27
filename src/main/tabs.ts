import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'path'
import type { TabState, Viewport } from '@shared/types'
import type { TabDebugger } from './cdp'

export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return 'about:blank'
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return t
  if (!t.includes(' ') && (t.includes('.') || t.startsWith('localhost'))) {
    const insecure = t.startsWith('localhost') || t.startsWith('127.') || t.startsWith('0.0.0.0')
    return (insecure ? 'http://' : 'https://') + t
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(t)
}

type Tab = {
  id: number
  view: WebContentsView
  dbg: TabDebugger
  favicon?: string
}

export class TabManager {
  private tabs = new Map<number, Tab>()
  private tabOrder: number[] = []
  activeId: number | null = null
  private viewport: Viewport = { x: 0, y: 0, width: 0, height: 0 }
  private paginaVisivel = true

  constructor(
    private win: BrowserWindow,
    private makeDebugger: (wc: WebContents, tabId: number) => TabDebugger
  ) {}

  private uiSend(channel: string, payload?: unknown) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  get(id: number): Tab | undefined {
    return this.tabs.get(id)
  }

  allTabs(): Tab[] {
    return this.tabOrder.map((id) => this.tabs.get(id)!).filter(Boolean)
  }

  list(): TabState[] {
    return this.allTabs().map((t) => {
      const wc = t.view.webContents
      const nav: any = (wc as any).navigationHistory
      return {
        id: t.id,
        url: wc.getURL() || 'about:blank',
        title: wc.getTitle() || 'Nova aba',
        favicon: t.favicon,
        loading: wc.isLoading(),
        canGoBack: nav ? nav.canGoBack() : (wc as any).canGoBack?.() ?? false,
        canGoForward: nav ? nav.canGoForward() : (wc as any).canGoForward?.() ?? false,
        active: t.id === this.activeId
      }
    })
  }

  pushState() {
    this.uiSend('tabs:state', this.list())
  }

  create(url = 'about:blank'): number {
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:jwww',
        preload: join(__dirname, '../preload/page.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    const wc = view.webContents
    const id = wc.id
    const dbg = this.makeDebugger(wc, id)
    const tab: Tab = { id, view, dbg }
    this.tabs.set(id, tab)
    this.tabOrder.push(id)
    this.win.contentView.addChildView(view)
    view.setVisible(false)

    const push = () => this.pushState()
    wc.on('page-title-updated', push)
    wc.on('did-start-loading', push)
    wc.on('did-stop-loading', push)
    wc.on('did-navigate', push)
    wc.on('did-navigate-in-page', push)
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons?.[0]
      push()
    })
    // Assinatura muda entre versões do Electron (args posicionais vs. objeto no event).
    wc.on('did-start-navigation', (e: any, _url?: string, _inPlace?: boolean, isMainFrameArg?: boolean) => {
      const isMainFrame = typeof e?.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrameArg
      const sameDoc = typeof e?.isSameDocument === 'boolean' ? e.isSameDocument : false
      if (isMainFrame && !sameDoc) dbg.onMainFrameNavigation()
    })
    wc.on('destroyed', () => {
      if (this.tabs.has(id)) this.close(id)
    })
    wc.setWindowOpenHandler(({ url: popupUrl }) => {
      this.create(popupUrl)
      return { action: 'deny' }
    })

    // O attach precisa completar antes do primeiro loadURL, senão o documento
    // inicial escapa da interceptação e os overrides não aplicam nele.
    // Um WebContentsView só ganha processo de renderer no primeiro load; antes
    // disso os comandos CDP ficam pendentes para sempre. Então: about:blank
    // (cria o renderer) -> attach (Fetch.enable ativo) -> navega de verdade, e
    // assim o documento inicial já passa pela interceptação de overrides.
    void wc
      .loadURL('about:blank')
      .catch(() => {})
      .then(() => dbg.attach())
      .then(() => {
        if (wc.isDestroyed() || url === 'about:blank') return
        return wc.loadURL(url).catch((err) => {
          console.warn('[tabs] loadURL falhou:', url, err?.message ?? err)
        })
      })

    this.activate(id)
    return id
  }

  /**
   * A página é um WebContentsView nativo composto **por cima** da janela, então
   * qualquer diálogo da UI que cruze a área dela some atrás. Enquanto um modal
   * está aberto, escondemos a página.
   */
  setPageVisible(visivel: boolean) {
    this.paginaVisivel = visivel
    for (const t of this.allTabs()) {
      t.view.setVisible(visivel && t.id === this.activeId)
    }
    if (visivel) this.applyViewport()
  }

  activate(id: number) {
    if (!this.tabs.has(id)) return
    this.activeId = id
    for (const t of this.allTabs()) {
      t.view.setVisible(this.paginaVisivel && t.id === id)
    }
    this.applyViewport()
    this.tabs.get(id)!.view.webContents.focus()
    this.pushState()
  }

  close(id: number) {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.tabs.delete(id)
    this.tabOrder = this.tabOrder.filter((x) => x !== id)
    try {
      this.win.contentView.removeChildView(tab.view)
    } catch {}
    const wc = tab.view.webContents
    if (!wc.isDestroyed()) wc.close()
    if (this.activeId === id) {
      const next = this.tabOrder[this.tabOrder.length - 1]
      this.activeId = null
      if (next !== undefined) this.activate(next)
    }
    this.pushState()
  }

  setViewport(v: Viewport) {
    this.viewport = {
      x: Math.round(v.x),
      y: Math.round(v.y),
      width: Math.round(v.width),
      height: Math.round(v.height)
    }
    this.applyViewport()
  }

  private applyViewport() {
    if (this.activeId === null) return
    const tab = this.tabs.get(this.activeId)
    if (tab && this.viewport.width > 0 && this.viewport.height > 0) {
      tab.view.setBounds(this.viewport)
    }
  }

  navigate(id: number, input: string) {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.view.webContents.loadURL(normalizeUrl(input)).catch(() => {})
  }

  reload(id: number, ignoreCache = false) {
    const wc = this.tabs.get(id)?.view.webContents
    if (!wc) return
    if (ignoreCache) wc.reloadIgnoringCache()
    else wc.reload()
  }

  back(id: number) {
    const wc = this.tabs.get(id)?.view.webContents
    if (!wc) return
    const nav: any = (wc as any).navigationHistory
    if (nav?.canGoBack()) nav.goBack()
    else (wc as any).goBack?.()
  }

  forward(id: number) {
    const wc = this.tabs.get(id)?.view.webContents
    if (!wc) return
    const nav: any = (wc as any).navigationHistory
    if (nav?.canGoForward()) nav.goForward()
    else (wc as any).goForward?.()
  }

  openDevTools(id: number) {
    const wc = this.tabs.get(id)?.view.webContents
    wc?.openDevTools({ mode: 'detach' })
  }

  isPageWebContents(wc: WebContents): boolean {
    return this.tabs.has(wc.id)
  }
}
