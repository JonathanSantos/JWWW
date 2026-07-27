import { build } from 'esbuild'
import { expect, test } from '@playwright/test'
import { launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { OverrideEntry } from '../../src/shared/schemas'

/** Fonte TypeScript de verdade — inclui tipos, que somem no build. */
const FONTE_TS = `interface Item {
  preco: number
  nome: string
}

const IMPOSTO: number = 0.1

export function calcularTotal(itens: Item[]): number {
  const bruto = itens.reduce((soma, item) => soma + item.preco, 0)
  return bruto * (1 + IMPOSTO)
}

export async function buscarNome(id: number): Promise<string> {
  await Promise.resolve()
  return "produto-" + id
}

declare global {
  interface Window {
    calcularTotal: typeof calcularTotal
    buscarNome: typeof buscarNome
  }
}

window.calcularTotal = calcularTotal
window.buscarNome = buscarNome
document.addEventListener("DOMContentLoaded", () => {
  document.body.innerHTML = "<h1>" + calcularTotal([{ preco: 10, nome: "a" }, { preco: 30, nome: "b" }]) + "</h1>"
})
`

/** Compila com esbuild para ter bundle minificado + source map reais. */
async function compilar(): Promise<{ js: string; map: string }> {
  const resultado = await build({
    stdin: { contents: FONTE_TS, loader: 'ts', sourcefile: 'src/app.ts', resolveDir: process.cwd() },
    bundle: true,
    minify: true,
    format: 'iife',
    sourcemap: true,
    write: false,
    outfile: 'app.js'
  })
  const js = resultado.outputFiles.find((f) => f.path.endsWith('.js'))!.text
  const map = resultado.outputFiles.find((f) => f.path.endsWith('.map'))!.text
  return { js, map }
}

const INDEX =
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>sourcemap</title>` +
  `<script src="/app.js"></script></head><body></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  const { js, map } = await compilar()
  site = await new FixtureSite()
    .set('/', INDEX)
    .js('/app.js', js)
    .set('/app.js.map', map, 'application/json')
    .start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

async function abrirBundle(jwww: JwwwApp) {
  await jwww.openPanel('Recursos')
  const item = jwww.ui.locator(`[title="${site.url('/app.js')}"]`)
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await expect(jwww.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })
}

test('encontra o source map e mostra o TypeScript original', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirBundle(app)

  // o bundle minificado cabe em pouquíssimas linhas
  const linhasBundle = await app.ui.locator('.view-line').count()
  expect(linhasBundle).toBeLessThan(5)

  const seletor = app.ui.locator('select[title*="fonte original"]')
  await expect(seletor).toBeVisible({ timeout: 25_000 })
  await seletor.selectOption({ label: 'src/app.ts' })

  await expect(app.ui.getByText('fonte original · leitura')).toBeVisible()
  // o Monaco renderiza espaços como
  const conteudo = (await app.ui.locator('.monaco-editor').innerText()).replace(/ /g, ' ')
  expect(conteudo, 'o fonte tem os tipos que não existem no bundle').toContain('interface Item')
  expect(conteudo).toContain('itens: Item[]')

  // fonte é leitura: sem Salvar, sem Formatar, sem Diff
  await expect(app.ui.getByRole('button', { name: 'Formatar' })).toHaveCount(0)
  await expect(app.ui.getByRole('button', { name: 'Diff' })).toHaveCount(0)
})

test('observar uma função selecionada no TypeScript instrumenta o bundle', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirBundle(app)

  const seletor = app.ui.locator('select[title*="fonte original"]')
  await expect(seletor).toBeVisible({ timeout: 25_000 })
  await seletor.selectOption({ label: 'src/app.ts' })
  await expect(app.ui.getByText('fonte original · leitura')).toBeVisible()

  // seleciona a função no FONTE, não no bundle
  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('export function calcularTotal')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')

  await app.ui.getByRole('button', { name: 'Observar' }).click()
  await expect(app.ui.getByText(/função/)).toBeVisible({ timeout: 15_000 })
  await app.ui.getByRole('button', { name: 'Observar', exact: true }).last().click()

  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'watch').length, {
      timeout: 15_000
    })
    .toBe(1)

  // A âncora precisa estar no BUNDLE (que é o que o servidor entrega),
  // não no TypeScript — o fonte não existe em runtime.
  const salvo = app.readStore<OverrideEntry>('overrides')[0]
  const bundle = site.bodyOf('/app.js')
  expect(salvo.watch!.selection, 'a âncora tem que existir no bundle servido').not.toBe('')
  expect(bundle.includes(salvo.watch!.selection), 'âncora encontrada no bundle').toBe(true)
  expect(salvo.watch!.selection, 'não pode ser o texto do TypeScript').not.toContain('Item[]')

  // e funciona de verdade em runtime
  await app.reloadPage()
  await app.openPanel('Observar')
  const retorno = await app.pageEval<number>('window.calcularTotal([{ preco: 100, nome: "x" }])')
  expect(retorno, 'a instrumentação não altera o resultado').toBeCloseTo(110, 5)
  await expect(app.ui.getByText('calcularTotal').first()).toBeVisible({ timeout: 20_000 })
})

test('avisa quando o ponto do fonte não existe no bundle', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirBundle(app)

  const seletor = app.ui.locator('select[title*="fonte original"]')
  await expect(seletor).toBeVisible({ timeout: 25_000 })
  await seletor.selectOption({ label: 'src/app.ts' })

  // `interface Item` é puramente de tipo: some no build
  await app.ui.locator('.monaco-editor .view-lines').click()
  await app.ui.keyboard.press('Meta+KeyF')
  await app.ui.keyboard.type('interface Item {')
  await app.ui.keyboard.press('Enter')
  await app.ui.keyboard.press('Escape')

  await app.ui.getByRole('button', { name: 'Observar' }).click()
  await expect(app.ui.getByText(/não tem correspondência no bundle|Só dá para observar/)).toBeVisible({
    timeout: 15_000
  })
  expect(app.readStore<OverrideEntry>('overrides')).toHaveLength(0)
})

test('sem source map, o seletor não aparece', async () => {
  const semMapa = await new FixtureSite()
    .set('/', INDEX)
    .js('/app.js', 'window.oi = function () { return 1 };')
    .start()
  const outro = await launchApp({ startUrl: semMapa.url('/') })
  try {
    await outro.openPanel('Recursos')
    await outro.ui.locator(`[title="${semMapa.url('/app.js')}"]`).click()
    await expect(outro.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })
    await expect(outro.ui.locator('select[title*="fonte original"]')).toHaveCount(0)
    await expect(outro.ui.getByRole('button', { name: 'Formatar' })).toBeVisible()
  } finally {
    await outro.close()
    await semMapa.stop()
  }
})
