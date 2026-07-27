import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NetRule, OverrideEntry, UserScript, Workspace } from '../../../src/shared/schemas'

export type Seed = {
  overrides?: OverrideEntry[]
  scripts?: UserScript[]
  rules?: NetRule[]
  workspaces?: Workspace[]
}

export type LaunchOptions = {
  startUrl?: string
  seed?: Seed
}

export class JwwwApp {
  constructor(
    readonly electronApp: ElectronApplication,
    readonly ui: Page,
    private readonly userDataDir: string
  ) {}

  /** Lê uma coleção persistida direto do disco — é a fonte da verdade. */
  readStore<T>(name: 'overrides' | 'userscripts' | 'netrules' | 'workspaces'): T[] {
    try {
      return JSON.parse(readFileSync(join(this.userDataDir, 'jwww-data', `${name}.json`), 'utf8'))
    } catch {
      return []
    }
  }

  /**
   * Roda JS dentro da página que está sendo navegada. Ela é um WebContentsView,
   * não uma janela, então não aparece para o Playwright — chegamos nela pelo
   * processo main.
   */
  /**
   * Roda JS numa página navegada. `filtroUrl` escolhe a aba quando há mais de
   * uma — é o que permite testar comunicação entre abas de domínios diferentes.
   */
  async pageEval<T = unknown>(expression: string, filtroUrl?: string): Promise<T> {
    return this.electronApp.evaluate(
      async ({ webContents }, { expr, filtro }) => {
        const paginas = webContents.getAllWebContents().filter((wc) => wc.getURL().startsWith('http'))
        const target = filtro ? paginas.find((wc) => wc.getURL().includes(filtro)) : paginas[0]
        if (!target) throw new Error(`nenhuma página encontrada${filtro ? ` para "${filtro}"` : ''}`)
        return target.executeJavaScript(expr, true)
      },
      { expr: expression, filtro: filtroUrl ?? null }
    )
  }

  /** Abre outra aba e espera ela terminar de carregar. */
  async openTab(url: string): Promise<number> {
    const id = await this.ui.evaluate((u) => window.api.tabs.create(u), url)
    await this.waitForPage(30_000, url)
    return id
  }

  /**
   * A aba é criada vazia e navega depois (o attach do CDP acontece antes do
   * loadURL), então esperar só pela janela da UI devolve um teste instável.
   */
  async waitForPage(timeoutMs = 30_000, filtroUrl?: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const ready = await this.electronApp.evaluate(({ webContents }, filtro) => {
        const paginas = webContents.getAllWebContents().filter((c) => c.getURL().startsWith('http'))
        const wc = filtro ? paginas.find((c) => c.getURL().includes(filtro)) : paginas[0]
        return Boolean(wc && !wc.isLoading())
      }, filtroUrl ?? null)
      if (ready) return
      if (Date.now() > deadline) throw new Error('a página não terminou de carregar a tempo')
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  async activeTabId(): Promise<number> {
    const tabs = await this.ui.evaluate(() => window.api.tabs.list())
    const active = tabs.find((t) => t.active)
    if (!active) throw new Error('nenhuma aba ativa')
    return active.id
  }

  async reloadPage(): Promise<void> {
    const id = await this.activeTabId()
    await this.ui.evaluate((tabId) => window.api.tabs.reload(tabId, true), id)
    // dá tempo do reload sair do estado "ocioso" antes de esperar terminar
    await this.ui.waitForTimeout(400)
    await this.waitForPage()
  }

  async openPanel(label: string): Promise<void> {
    await this.ui.getByRole('tab', { name: label, exact: true }).click()
  }

  async close(): Promise<void> {
    await this.electronApp.close().catch(() => {})
    rmSync(this.userDataDir, { recursive: true, force: true })
  }
}

/**
 * Cada teste roda com userData próprio: nunca encosta nos overrides reais do
 * dev, e o lock de instância única (que é por userData) deixa de brigar com um
 * JWWW aberto na máquina.
 */
export async function launchApp(opts: LaunchOptions = {}): Promise<JwwwApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'jwww-e2e-'))
  const dataDir = join(userDataDir, 'jwww-data')
  mkdirSync(dataDir, { recursive: true })

  const seed = opts.seed ?? {}
  const collections: Array<[string, unknown[]]> = [
    ['overrides', seed.overrides ?? []],
    ['userscripts', seed.scripts ?? []],
    ['netrules', seed.rules ?? []],
    ['workspaces', seed.workspaces ?? []]
  ]
  for (const [name, items] of collections) {
    writeFileSync(join(dataDir, `${name}.json`), JSON.stringify(items, null, 2))
  }

  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ...(opts.startUrl ? { JWWW_START_URL: opts.startUrl } : {})
    }
  })

  const ui = await electronApp.firstWindow()
  await ui.waitForLoadState('domcontentloaded')
  await ui.waitForFunction(() => Boolean(window.api), undefined, { timeout: 20_000 })

  const jwww = new JwwwApp(electronApp, ui, userDataDir)
  if (opts.startUrl) await jwww.waitForPage()
  return jwww
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Monta um override de edição já no formato persistido. */
export function editOverride(
  url: string,
  original: string,
  edited: string,
  extra: Partial<OverrideEntry> = {}
): OverrideEntry {
  return {
    id: randomUUID(),
    url,
    kind: 'edit',
    enabled: true,
    contentType: 'js',
    originalHash: sha256(original),
    originalText: original,
    editedText: edited,
    updatedAt: Date.now(),
    ...extra
  }
}

export function userScript(code: string, extra: Partial<UserScript> = {}): UserScript {
  return {
    id: randomUUID(),
    name: 'script de teste',
    matches: ['*'],
    runAt: 'document-end',
    code,
    enabled: true,
    updatedAt: Date.now(),
    ...extra
  }
}
