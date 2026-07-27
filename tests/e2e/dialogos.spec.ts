import { expect, test } from '@playwright/test'
import { launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const APP_JS = `function calcular(n) { return n * 2 }
window.calcular = calcular`

const INDEX =
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>dialogo</title>` +
  `<script src="/app.js"></script></head><body><h1>site</h1></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  site = await new FixtureSite().set('/', INDEX).js('/app.js', APP_JS).start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

/**
 * A página é um WebContentsView nativo, composto por cima da janela da UI.
 * Se ela continuar visível, o diálogo aparece cortado atrás dela.
 */
function paginaVisivel(jwww: JwwwApp): Promise<boolean> {
  return jwww.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win.contentView.children.some((v) => v.getVisible())
  })
}

test('a página some enquanto um diálogo está aberto e volta ao fechar', async () => {
  app = await launchApp({ startUrl: site.url('/') })

  expect(await paginaVisivel(app), 'página visível no estado normal').toBe(true)

  await app.openPanel('Recursos')
  await app.ui.locator(`[title="${site.url('/app.js')}"]`).click()
  await expect(app.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })

  // seleciona a função e abre o diálogo de observar
  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('function calcular(n)')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')
  await app.ui.getByRole('button', { name: 'Observar' }).click()

  const dialogo = app.ui.getByRole('dialog')
  await expect(dialogo).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() => paginaVisivel(app!), { timeout: 10_000 })
    .toBe(false)

  // o diálogo precisa caber inteiro na janela, não só existir
  const caixa = await dialogo.boundingBox()
  const janela = app.ui.viewportSize()
  expect(caixa, 'diálogo tem área').not.toBeNull()
  expect(caixa!.x, 'não pode começar fora da janela').toBeGreaterThanOrEqual(0)
  if (janela) {
    expect(caixa!.x + caixa!.width, 'não pode passar da borda direita').toBeLessThanOrEqual(janela.width + 1)
  }

  await app.ui.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toBeHidden()
  await expect.poll(() => paginaVisivel(app!), { timeout: 10_000 }).toBe(true)
})

test('a página volta mesmo se o diálogo for fechado pelo Escape', async () => {
  app = await launchApp({ startUrl: site.url('/') })

  await app.openPanel('Recursos')
  await app.ui.locator(`[title="${site.url('/app.js')}"]`).click()
  await expect(app.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })

  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('function calcular(n)')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')
  await app.ui.getByRole('button', { name: 'Observar' }).click()
  await expect(app.ui.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => paginaVisivel(app!), { timeout: 10_000 }).toBe(false)

  await app.ui.keyboard.press('Escape')
  await expect(app.ui.getByRole('dialog')).toBeHidden()
  await expect.poll(() => paginaVisivel(app!), { timeout: 10_000 }).toBe(true)
})

test('trocar de aba com a página escondida não a deixa presa invisível', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await app.openPanel('Overrides')

  // dispara um diálogo pela lista de overrides
  await app.ui.evaluate(async () => {
    await window.api.overrides.save({
      id: 'x1',
      url: 'https://exemplo.test/app.js',
      kind: 'edit',
      enabled: true,
      contentType: 'js',
      originalHash: 'abc',
      originalText: 'a',
      editedText: 'b',
      updatedAt: Date.now()
    })
  })
  await app.ui.getByTitle('Editar padrão de URL').click()
  await expect(app.ui.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => paginaVisivel(app!), { timeout: 10_000 }).toBe(false)

  await app.ui.getByRole('button', { name: 'Cancelar' }).click()
  await expect.poll(() => paginaVisivel(app!), { timeout: 10_000 }).toBe(true)
})
