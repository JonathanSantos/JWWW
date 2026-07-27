import { build } from 'esbuild'
import { expect, test } from '@playwright/test'
import { launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { OverrideEntry } from '../../src/shared/schemas'

/** Cada função tem um papel diferente: carregamento, clique, ou nunca roda. */
const APP_JS = `function usadaNoCarregamento(n) {
  return n * 2;
}
function chamadaNoClique(quantas) {
  var total = 0;
  for (var i = 0; i < quantas; i++) total += somaInterna(i);
  return total;
}
function somaInterna(x) {
  return x + 1;
}
function nuncaChamada() {
  return "morta";
}
document.addEventListener("DOMContentLoaded", function () {
  document.body.innerHTML =
    '<h1>' + usadaNoCarregamento(21) + '</h1><button id="b">clique</button>';
  document.getElementById("b").addEventListener("click", function () {
    document.body.setAttribute("data-total", String(chamadaNoClique(5)));
  });
});`

const INDEX =
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>mapa</title>` +
  `<script src="/app.js"></script></head><body></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.afterEach(async () => {
  await app?.close()
  app = null
  await site?.stop()
})

async function abrirArquivo(jwww: JwwwApp, url: string) {
  await jwww.openPanel('Recursos')
  const item = jwww.ui.locator(`[title="${url}"]`)
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await expect(jwww.ui.locator('.view-line').first()).toBeVisible({ timeout: 25_000 })
}

test('mapeia o arquivo e mostra o que executou, com o que nunca rodou de fora', async () => {
  site = await new FixtureSite().set('/', INDEX).js('/app.js', APP_JS).start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirArquivo(app, site.url('/app.js'))

  await app.ui.getByRole('button', { name: 'Mapear' }).click()
  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'map').length, {
      timeout: 15_000
    })
    .toBe(1)

  await app.reloadPage()
  await app.openPanel('Mapa')

  // a página só chamou usadaNoCarregamento; o resto está no clique ou morto
  await expect(app.ui.getByText('usadaNoCarregamento')).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText('nuncaChamada')).toHaveCount(0)
  await expect(app.ui.getByText(/de \d+ funções executaram/)).toBeVisible()

  // e a instrumentação não mudou o resultado da página
  const titulo = await app.pageEval<string>('document.querySelector("h1").textContent')
  expect(titulo, 'o valor calculado tem que continuar o mesmo').toBe('42')
})

test('zerar e interagir isola o que aquela ação disparou', async () => {
  site = await new FixtureSite().set('/', INDEX).js('/app.js', APP_JS).start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirArquivo(app, site.url('/app.js'))
  await app.ui.getByRole('button', { name: 'Mapear' }).click()
  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'map').length, {
      timeout: 15_000
    })
    .toBe(1)

  await app.reloadPage()
  await app.openPanel('Mapa')
  await expect(app.ui.getByText('usadaNoCarregamento')).toBeVisible({ timeout: 25_000 })

  // zera: some tudo que rodou no carregamento
  await app.ui.getByRole('button', { name: 'Zerar contadores' }).click()
  await expect(app.ui.getByText('usadaNoCarregamento')).toHaveCount(0)

  // agora a interação: só o que ela dispara deve aparecer
  await app.pageEval('document.getElementById("b").click()')

  await expect(app.ui.getByText('chamadaNoClique')).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText('somaInterna')).toBeVisible()
  await expect(
    app.ui.getByText('usadaNoCarregamento'),
    'o que rodou antes do zerar não pode voltar'
  ).toHaveCount(0)

  // o laço chamou somaInterna 5 vezes: a contagem tem que refletir isso
  const linhaSoma = app.ui.locator('div', { hasText: /^somaInterna/ }).last()
  await expect(linhaSoma).toContainText('5')
  const total = await app.pageEval<string>('document.body.getAttribute("data-total")')
  expect(total, 'o laço instrumentado devolve o mesmo valor').toBe('15')
})

test('usa os nomes originais quando o site publica source map', async () => {
  const fonte = `export function calcularDesconto(valor: number): number {
  return valor * 0.9
}
window.addEventListener("DOMContentLoaded", () => {
  document.body.innerHTML = "<h1>" + calcularDesconto(100) + "</h1>"
})
`
  const r = await build({
    stdin: { contents: fonte, loader: 'ts', sourcefile: 'src/precos.ts', resolveDir: process.cwd() },
    bundle: true,
    minify: true,
    format: 'iife',
    sourcemap: true,
    write: false,
    outfile: 'app.js'
  })
  site = await new FixtureSite()
    .set('/', INDEX)
    .js('/app.js', r.outputFiles.find((f) => f.path.endsWith('.js'))!.text)
    .set('/app.js.map', r.outputFiles.find((f) => f.path.endsWith('.map'))!.text, 'application/json')
    .start()

  app = await launchApp({ startUrl: site.url('/') })
  await abrirArquivo(app, site.url('/app.js'))
  await app.ui.getByRole('button', { name: 'Mapear' }).click()
  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'map').length, {
      timeout: 15_000
    })
    .toBe(1)
  await app.reloadPage()
  await app.openPanel('Mapa')

  await expect(app.ui.getByText('nomes originais')).toBeVisible({ timeout: 25_000 })
  // o bundle minificado chamaria isso de `n` ou parecido
  await expect(app.ui.getByText('calcularDesconto')).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText(/precos\.ts:\d+/).first()).toBeVisible()
})

test('desligar o mapeamento remove a instrumentação', async () => {
  site = await new FixtureSite().set('/', INDEX).js('/app.js', APP_JS).start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirArquivo(app, site.url('/app.js'))

  await app.ui.getByRole('button', { name: 'Mapear' }).click()
  await expect(app.ui.getByRole('button', { name: 'Mapeando' })).toBeVisible({ timeout: 15_000 })

  await app.ui.getByRole('button', { name: 'Mapeando' }).click()
  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'map').length, {
      timeout: 15_000
    })
    .toBe(0)

  await app.reloadPage()
  const instrumentado = await app.pageEval<boolean>(
    `(async () => (await (await fetch(document.querySelector('script').src)).text()).includes('__jwwwMap'))()`
  )
  expect(instrumentado, 'o arquivo servido volta ao original').toBe(false)
})

test('separa tempo próprio de tempo total', async () => {
  // `externa` quase não faz nada sozinha; `interna` é que queima CPU.
  // Com tempo inclusivo, `externa` apareceria no topo — o que é enganoso.
  site = await new FixtureSite()
    .set('/', INDEX)
    .js(
      '/app.js',
      `function interna() {
         var s = 0;
         for (var i = 0; i < 3000000; i++) s += i;
         return s;
       }
       function externa() { return interna() }
       window.externa = externa;
       document.addEventListener("DOMContentLoaded", function () { externa() });`
    )
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirArquivo(app, site.url('/app.js'))

  await app.ui.getByRole('button', { name: 'Mapear' }).click()
  await expect
    .poll(() => app!.readStore<OverrideEntry>('overrides').filter((o) => o.kind === 'map').length, {
      timeout: 15_000
    })
    .toBe(1)
  await app.reloadPage()
  await app.openPanel('Mapa')
  await expect(app.ui.getByText('interna')).toBeVisible({ timeout: 25_000 })

  // por tempo próprio, quem queima CPU tem que vir na frente
  await app.ui.getByRole('combobox').last().selectOption('proprio')
  const ordemPropria = await app.ui.locator('[title*="offset"]').allInnerTexts()
  const idxInterna = ordemPropria.findIndex((t) => t.includes('interna'))
  const idxExterna = ordemPropria.findIndex((t) => t.includes('externa'))
  expect(idxInterna, 'interna deve existir na lista').toBeGreaterThanOrEqual(0)
  expect(idxExterna, 'externa deve existir na lista').toBeGreaterThanOrEqual(0)
  expect(idxInterna, 'por tempo próprio, interna vem antes de externa').toBeLessThan(idxExterna)

  // por tempo total, a de fora engloba a de dentro e sobe
  await app.ui.getByRole('combobox').last().selectOption('total')
  const ordemTotal = await app.ui.locator('[title*="offset"]').allInnerTexts()
  expect(
    ordemTotal.findIndex((t) => t.includes('externa')),
    'por tempo total, externa vem antes de interna'
  ).toBeLessThan(ordemTotal.findIndex((t) => t.includes('interna')))

})
