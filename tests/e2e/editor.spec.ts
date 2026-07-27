import { expect, test } from '@playwright/test'
import { editOverride, launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { OverrideEntry } from '../../src/shared/schemas'

const MINIFICADO = `(function(){var cfg={api:"https://interno/v1",token:"abc-123"};function total(l){return l.reduce(function(s,i){return s+i.p},0)}document.addEventListener("DOMContentLoaded",function(){document.body.innerHTML="<h1>"+total([{p:10},{p:32}])+"</h1>"})})();`

const INDEX =
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>editor</title>` +
  `<script src="/app.js"></script></head><body></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  site = await new FixtureSite().set('/', INDEX).js('/app.js', MINIFICADO).start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

/** Abre o arquivo pelo painel Recursos, como o dev faria. */
async function abrirNoEditor(jwww: JwwwApp, url: string) {
  await jwww.openPanel('Recursos')
  const item = jwww.ui.locator(`[title="${url}"]`)
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await expect(jwww.ui.locator('.monaco-editor')).toBeVisible({ timeout: 25_000 })
  await expect(jwww.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })
}

test('formatar, editar e salvar mantém o arquivo servido no formato original', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirNoEditor(app, site.url('/app.js'))

  // Sem formatar, o bundle é uma linha só.
  await expect(app.ui.locator('.view-line')).toHaveCount(1)

  await app.ui.getByRole('button', { name: 'Formatar' }).click()
  await expect(app.ui.getByText('formatado', { exact: true })).toBeVisible()
  const linhasFormatadas = await app.ui.locator('.view-line').count()
  expect(linhasFormatadas, 'o código formatado deve ocupar várias linhas').toBeGreaterThan(3)

  // digita no texto formatado
  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.type('/*EDITADO_NO_FORMATADO*/')
  await app.ui.getByRole('button', { name: 'Salvar' }).click()

  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').length, { timeout: 15_000 })
    .toBe(1)

  const salvo = app.readStore<OverrideEntry>('overrides')[0]
  expect(salvo.editedText, 'a edição do dev precisa estar lá').toContain('/*EDITADO_NO_FORMATADO*/')
  expect(
    salvo.editedText!.split('\n').filter((l) => l.trim()).length,
    'o override salvo não pode virar o arquivo inteiro reformatado'
  ).toBe(1)
  expect(
    salvo.editedText!.replace('/*EDITADO_NO_FORMATADO*/', ''),
    'o resto do arquivo tem que ficar byte a byte igual ao original'
  ).toBe(MINIFICADO)
})

test('o diff mostra a mudança em modo inline, nos dois sentidos', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [
        editOverride(site.url('/app.js'), MINIFICADO, MINIFICADO.replace('var cfg=', 'var cfg=/*marca*/'))
      ]
    }
  })
  await abrirNoEditor(app, site.url('/app.js'))

  await app.ui.getByRole('button', { name: 'Diff' }).click()
  const diff = app.ui.locator('.monaco-diff-editor')
  await expect(diff).toBeVisible({ timeout: 25_000 })

  // Inline: o painel da esquerda fica só com a calha de números.
  const larguras = await diff.locator('.editor').evaluateAll((els) => els.map((e) => e.clientWidth))
  expect(larguras[0], 'lado original deve ser só a calha').toBeLessThan(100)
  expect(larguras[1], 'o conteúdo ocupa a largura toda').toBeGreaterThan(300)

  await expect(diff.locator('.char-insert, .line-insert').first()).toBeVisible()
  const textoDiff = (await diff.innerText()).replace(/ /g, ' ')
  expect(textoDiff, 'a inserção do override deve aparecer').toContain('/*marca*/')

  // modo "original × servidor agora": o site mudou por baixo
  site.js('/app.js', MINIFICADO.replace('abc-123', 'TOKEN_DO_SERVIDOR'))
  await app.ui.getByRole('combobox').selectOption('server')
  await expect
    .poll(async () => (await diff.innerText()).replace(/ /g, ' '), { timeout: 25_000 })
    .toContain('TOKEN_DO_SERVIDOR')
})

test('expor seleção de JS cria a global no próximo carregamento', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirNoEditor(app, site.url('/app.js'))

  // A busca do Monaco deixa o trecho encontrado como seleção ativa ao fechar.
  // (Cmd+L expandiria para a linha inteira e a âncora viraria o arquivo todo.)
  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('{api:"https://interno/v1",token:"abc-123"}')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')

  await app.ui.getByRole('button', { name: 'Expor global' }).click()
  await app.ui.getByPlaceholder('nomeDaGlobal').fill('cfgExposta')
  await app.ui.getByRole('button', { name: 'Expor', exact: true }).click()

  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'expose').length, {
      timeout: 15_000
    })
    .toBe(1)

  await app.reloadPage()
  await expect
    .poll(() => app!.pageEval<string>('typeof globalThis.cfgExposta'), { timeout: 25_000 })
    .toBe('object')
  const valor = await app.pageEval<{ token: string }>('globalThis.cfgExposta')
  expect(valor.token).toBe('abc-123')
})
