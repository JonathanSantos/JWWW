import { expect, test } from '@playwright/test'
import { launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const PAGINA = (corpo: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>console</title></head>` +
  `<body><h1>site</h1><script>${corpo}</script></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.afterEach(async () => {
  await app?.close()
  app = null
  await site?.stop()
})

async function abrirConsole(jwww: JwwwApp) {
  await jwww.openPanel('Console')
}

async function avaliar(jwww: JwwwApp, expressao: string) {
  const campo = jwww.ui.getByPlaceholder(/expressão JS/)
  await campo.click()
  await campo.fill(expressao)
  await jwww.ui.keyboard.press('Enter')
}

test('mostra console.log da página, com os níveis distintos', async () => {
  site = await new FixtureSite()
    .set(
      '/',
      PAGINA(`
        console.log("mensagem simples");
        console.warn("cuidado aqui");
        console.error("deu ruim");
        console.info("informativo");
      `)
    )
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await expect(app.ui.getByText('mensagem simples')).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText('cuidado aqui')).toBeVisible()
  await expect(app.ui.getByText('deu ruim')).toBeVisible()
  await expect(app.ui.getByText('informativo')).toBeVisible()

  // o filtro tem que separar de verdade
  await app.ui.getByRole('combobox').selectOption('erros')
  await expect(app.ui.getByText('deu ruim')).toBeVisible()
  await expect(app.ui.getByText('mensagem simples')).toHaveCount(0)
  await expect(app.ui.getByText('cuidado aqui')).toHaveCount(0)
})

test('objetos chegam expandíveis, não como texto achatado', async () => {
  site = await new FixtureSite()
    .set('/', PAGINA(`console.log("dados:", { nome: "ana", idade: 33, tags: ["a","b"] });`))
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  // a prévia já mostra o conteúdo, sem precisar expandir
  await expect(app.ui.getByText(/nome: "?ana"?/)).toBeVisible({ timeout: 25_000 })

  // e expandir busca as propriedades de verdade na página
  await app.ui.getByText(/nome: "?ana"?/).click()
  await expect(app.ui.getByText('idade', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(app.ui.getByText('33', { exact: true })).toBeVisible()
})

test('avalia expressão no contexto da página', async () => {
  site = await new FixtureSite()
    .set('/', PAGINA(`window.segredoDoSite = { token: "abc-123" }; var contador = 7;`))
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await avaliar(app, '1 + 1')
  await expect(app.ui.getByText('2', { exact: true })).toBeVisible({ timeout: 25_000 })

  // alcança variáveis do próprio site, não de um contexto isolado
  await avaliar(app, 'contador * 6')
  await expect(app.ui.getByText('42', { exact: true })).toBeVisible({ timeout: 15_000 })

  await avaliar(app, 'segredoDoSite')
  await expect(app.ui.getByText(/token: "?abc-123"?/)).toBeVisible({ timeout: 15_000 })

  // e consegue mexer no DOM da página
  await avaliar(app, 'document.querySelector("h1").textContent = "mudado pelo console"')
  await expect
    .poll(() => app!.pageEval<string>('document.querySelector("h1").textContent'), { timeout: 15_000 })
    .toBe('mudado pelo console')
})

test('erro na expressão aparece como erro, sem derrubar o console', async () => {
  site = await new FixtureSite().set('/', PAGINA('')).start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await avaliar(app, 'naoExisteEssaFuncao()')
  await expect(app.ui.getByText(/naoExisteEssaFuncao is not defined/)).toBeVisible({ timeout: 25_000 })

  // o console continua funcionando depois do erro.
  // (aparece duas vezes: o eco do que foi digitado e o resultado — daí o .last)
  await avaliar(app, '"segue vivo"')
  await expect(app.ui.getByText(/segue vivo/).last()).toBeVisible({ timeout: 15_000 })
})

test('erro não capturado da página vira entrada de erro com pilha', async () => {
  site = await new FixtureSite()
    .set('/', PAGINA(`function quebra() { throw new Error("falha proposital") } setTimeout(quebra, 0);`))
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await expect(app.ui.getByText(/falha proposital/)).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText(/quebra —/).first()).toBeVisible({ timeout: 15_000 })
})

test('promessa rejeitada sem catch também aparece', async () => {
  site = await new FixtureSite()
    .set('/', PAGINA(`Promise.reject(new Error("rejeitada sem catch"));`))
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await expect(app.ui.getByText(/rejeitada sem catch/)).toBeVisible({ timeout: 25_000 })
})

test('histórico com seta para cima e limpar', async () => {
  site = await new FixtureSite().set('/', PAGINA('')).start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await avaliar(app, '"primeira"')
  await avaliar(app, '"segunda"')
  await expect(app.ui.getByText(/segunda/).first()).toBeVisible({ timeout: 25_000 })

  const campo = app.ui.getByPlaceholder(/expressão JS/)
  await campo.click()
  await app.ui.keyboard.press('ArrowUp')
  await expect(campo).toHaveValue('"segunda"')
  await app.ui.keyboard.press('ArrowUp')
  await expect(campo).toHaveValue('"primeira"')

  await campo.fill('')
  await app.ui.getByTitle('Limpar console').click()
  await expect(app.ui.getByText(/Nada no console ainda/)).toBeVisible({ timeout: 15_000 })
})

test('navegar limpa o console da aba', async () => {
  site = await new FixtureSite()
    .set('/', PAGINA(`console.log("da primeira página");`))
    .set('/outra', PAGINA(`console.log("da segunda página");`))
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)
  await expect(app.ui.getByText('da primeira página')).toBeVisible({ timeout: 25_000 })

  const id = await app.activeTabId()
  await app.ui.evaluate(
    ({ tabId, url }) => window.api.tabs.navigate(tabId, url),
    { tabId: id, url: site.url('/outra') }
  )
  await app.waitForPage()

  await expect(app.ui.getByText('da segunda página')).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText('da primeira página')).toHaveCount(0)
})

test('interpreta as diretivas de formatação do console', async () => {
  site = await new FixtureSite()
    .set(
      '/',
      PAGINA(`
        console.log("%cdestacado%c normal", "color: red; font-weight: bold", "");
        console.log("%s tem %d anos", "ana", 33.7);
        console.log("obj: %o", { a: 1 });
        console.log("100%% de cobertura");
      `)
    )
    .start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  // %c consome o CSS: ele não pode aparecer como texto
  await expect(app.ui.getByText('destacado')).toBeVisible({ timeout: 25_000 })
  await expect(app.ui.getByText(/font-weight: bold/)).toHaveCount(0)
  await expect(app.ui.getByText(/%c/)).toHaveCount(0)

  // e o estilo é aplicado de verdade
  const cor = await app.ui
    .getByText('destacado')
    .evaluate((el) => getComputedStyle(el).color)
  expect(cor, 'a cor pedida pelo site deve valer').toContain('255, 0, 0')

  // %s e %d substituem na posição certa, com %d truncando
  await expect(app.ui.getByText('ana tem 33 anos')).toBeVisible()

  // %o mantém o objeto expansível em vez de virar texto
  await expect(app.ui.getByText(/obj:/)).toBeVisible()
  await expect(app.ui.getByText(/a: 1/)).toBeVisible()

  // %% é um por cento literal
  await expect(app.ui.getByText('100% de cobertura')).toBeVisible()
})

test('não polui o console com avisos do próprio Electron', async () => {
  site = await new FixtureSite().set('/', PAGINA(`console.log("só isto");`)).start()
  app = await launchApp({ startUrl: site.url('/') })
  await abrirConsole(app)

  await expect(app.ui.getByText('só isto')).toBeVisible({ timeout: 25_000 })
  await expect(
    app.ui.getByText(/Electron Security Warning/),
    'aviso do nosso app não é problema do site'
  ).toHaveCount(0)
  await expect(app.ui.getByText(/sandbox_bundle/)).toHaveCount(0)
})
