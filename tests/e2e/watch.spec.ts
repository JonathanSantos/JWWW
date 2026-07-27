import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { launchApp, sha256, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { OverrideEntry } from '../../src/shared/schemas'

const APP_JS = `function calcularTotal(itens) {
  return itens.reduce(function (s, i) { return s + i.preco }, 0);
}
async function buscarNome(id) {
  await Promise.resolve();
  if (id < 0) throw new Error("id inválido");
  return "produto-" + id;
}
window.calcularTotal = calcularTotal;
window.buscarNome = buscarNome;
document.addEventListener("DOMContentLoaded", function () {
  document.body.innerHTML = "<h1>" + calcularTotal([{ preco: 10 }, { preco: 32 }]) + "</h1>";
});`

const INDEX =
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>observar</title>` +
  `<script src="/app.js"></script></head><body></body></html>`

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

function watchOverride(url: string, trecho: string, label: string, stack = false): OverrideEntry {
  const start = APP_JS.indexOf(trecho)
  if (start === -1) throw new Error('trecho não encontrado')
  return {
    id: randomUUID(),
    url,
    kind: 'watch',
    enabled: true,
    contentType: 'js',
    originalHash: sha256(APP_JS),
    originalText: '',
    watch: {
      label,
      selection: trecho,
      prefix: APP_JS.slice(Math.max(0, start - 80), start),
      suffix: APP_JS.slice(start + trecho.length, start + trecho.length + 80),
      stack
    },
    updatedAt: Date.now()
  }
}

test('registra cada execução da função observada com argumentos e retorno', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [
        watchOverride(
          site.url('/app.js'),
          'function calcularTotal(itens) {\n  return itens.reduce(function (s, i) { return s + i.preco }, 0);\n}',
          'calcularTotal'
        )
      ]
    }
  })

  // A página chama a função sozinha no DOMContentLoaded (10 + 32).
  // O valor renderizado prova que a instrumentação não alterou o retorno.
  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 20_000 })
    .toContain('42')

  await app.openPanel('Observar')
  await expect(app.ui.getByText('calcularTotal').first()).toBeVisible({ timeout: 20_000 })
  await expect(app.ui.getByText('42').first()).toBeVisible()

  // uma chamada nova aparece como um novo registro
  const antes = await app.ui.locator('[class*="rounded-md bg-secondary/40"]').count()
  const retorno = await app.pageEval<number>('window.calcularTotal([{ preco: 1 }, { preco: 6 }])')
  expect(retorno, 'o retorno chega intacto a quem chamou').toBe(7)
  await expect
    .poll(() => app!.ui.locator('[class*="rounded-md bg-secondary/40"]').count(), { timeout: 20_000 })
    .toBeGreaterThan(antes)
  await expect(app.ui.getByText('7').first()).toBeVisible()
})

test('o painel Observar mostra chamada, retorno e erro', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [
        watchOverride(
          site.url('/app.js'),
          'async function buscarNome(id) {\n  await Promise.resolve();\n  if (id < 0) throw new Error("id inválido");\n  return "produto-" + id;\n}',
          'buscarNome',
          true
        )
      ]
    }
  })

  await app.openPanel('Observar')
  await expect(app.ui.getByText('buscarNome').first()).toBeVisible({ timeout: 20_000 })

  await app.pageEval('window.buscarNome(7)')
  await expect(app.ui.getByText('produto-7')).toBeVisible({ timeout: 20_000 })
  await expect(app.ui.getByText('async').first()).toBeVisible()

  // erro também é registrado, e a exceção continua sendo lançada para a página
  const propagou = await app.pageEval<string>(
    `window.buscarNome(-1).then(() => "não lançou", (e) => e.message)`
  )
  expect(propagou, 'a instrumentação não pode engolir a exceção').toBe('id inválido')
  await expect(app.ui.getByText(/id inválido/)).toBeVisible({ timeout: 20_000 })
})

test('criar a observação pela interface, a partir da seleção no editor', async () => {
  app = await launchApp({ startUrl: site.url('/') })

  await app.openPanel('Recursos')
  const item = app.ui.locator(`[title="${site.url('/app.js')}"]`)
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await expect(app.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })

  // seleciona a função pelo buscador do Monaco
  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('async function buscarNome(id) {')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')

  await app.ui.getByRole('button', { name: 'Observar' }).click()
  // o AST precisa ter reconhecido a função e sugerido o nome dela
  await expect(app.ui.getByText(/função async buscarNome\(id\)/)).toBeVisible()
  await app.ui.getByRole('button', { name: 'Observar', exact: true }).last().click()

  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'watch').length, {
      timeout: 15_000
    })
    .toBe(1)
  expect(app.readStore<OverrideEntry>('overrides')[0].watch?.label).toBe('buscarNome')

  await app.reloadPage()
  await app.openPanel('Observar')
  await app.pageEval('window.buscarNome(3)')
  await expect(app.ui.getByText('produto-3')).toBeVisible({ timeout: 20_000 })
})

test('recusa observar um trecho que não é função nem expressão', async () => {
  app = await launchApp({ startUrl: site.url('/') })

  await app.openPanel('Recursos')
  await app.ui.locator(`[title="${site.url('/app.js')}"]`).click()
  await expect(app.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })

  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('window.calcularTotal = calcularTotal;')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')

  await app.ui.getByRole('button', { name: 'Observar' }).click()
  await expect(app.ui.getByText(/Só dá para observar função ou expressão/)).toBeVisible({ timeout: 15_000 })
  expect(app.readStore<OverrideEntry>('overrides')).toHaveLength(0)
})
