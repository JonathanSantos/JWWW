import { expect, test } from '@playwright/test'
import { editOverride, launchApp, packagedBinary, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

/**
 * Teste de fumaça do artefato empacotado.
 *
 * O resto da suíte roda o `out/` direto do disco, então nunca passa pelo asar
 * nem pelos caminhos relativos que só existem dentro do bundle. É exatamente aí
 * que empacotamento quebra: preload não encontrado, `index.html` fora do asar,
 * dependência que ficou de fora do pacote. Roda depois de:
 *
 *   npm run dist:dir
 */
const binario = packagedBinary()

test.describe('app empacotado', () => {
  test.skip(!binario, 'nenhum pacote em dist/ — rode `npm run dist:dir` antes')

  const APP_JS = `window.marcaDoFixture = "original";`
  const INDEX =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>pacote</title>` +
    `<script src="/app.js"></script></head><body><h1>empacotado</h1></body></html>`

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

  test('sobe, navega e mantém as features funcionando de dentro do asar', async () => {
    const original = site.bodyOf('/app.js')
    app = await launchApp({
      executablePath: binario!,
      startUrl: site.url('/'),
      seed: {
        overrides: [
          editOverride(site.url('/app.js'), original, original.replace('original', 'SOBRESCRITO'))
        ]
      }
    })

    // 1. o renderer carregou de dentro do asar (loadFile com caminho relativo)
    await expect(app.ui.getByTitle('Nova aba (⌘T)')).toBeVisible({ timeout: 25_000 })

    // 2. o CDP anexou e o override foi aplicado no primeiro carregamento
    await expect
      .poll(() => app!.pageEval<string>('window.marcaDoFixture'), { timeout: 25_000 })
      .toBe('SOBRESCRITO')

    // 3. o preload da página (dentro do asar) entrou junto, e o toolkit subiu
    //    em cima da ponte que ele expõe
    expect(await app.pageEval<string>('typeof __jwwwBridge')).toBe('object')
    await expect
      .poll(() => app!.pageEval<string>('typeof jwww?.ui?.sidebar'), { timeout: 15_000 })
      .toBe('function')

    // 4. o console conversa com a página empacotada
    await app.openPanel('Console')
    const campo = app.ui.getByPlaceholder(/expressão JS/)
    await campo.click()
    await campo.fill('document.querySelector("h1").textContent')
    await app.ui.keyboard.press('Enter')
    await expect(app.ui.getByText('empacotado').first()).toBeVisible({ timeout: 20_000 })
  })
})
