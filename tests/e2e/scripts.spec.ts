import { expect, test } from '@playwright/test'
import { launchApp, userScript, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { UserScript } from '../../src/shared/schemas'

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>site</title></head>` +
  `<body><h1>site</h1></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  site = await new FixtureSite().set('/', PAGINA).start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

async function abrirScripts(jwww: JwwwApp) {
  await jwww.openPanel('Scripts')
}

test('script novo nasce preso à página atual, não em todos os sites', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirScripts(app)
  await app.ui.getByRole('button', { name: 'Script em branco' }).click()

  const padroes = app.ui.getByPlaceholder(/Padrões de URL/)
  const origem = new URL(site.url('/')).origin
  await expect(padroes).toHaveValue(`${origem}/*`)

  // salvar não deve pedir confirmação nenhuma: o padrão é restrito
  await app.ui.getByRole('button', { name: 'Salvar' }).click()
  await expect(app.ui.getByText('Script salvo')).toBeVisible({ timeout: 15_000 })
  await expect(app.ui.getByText('Rodar em todos os sites?')).toHaveCount(0)

  const salvos = app.readStore<UserScript>('userscripts')
  expect(salvos).toHaveLength(1)
  expect(salvos[0].matches, 'o padrão gravado prende o script à origem').toEqual([`${origem}/*`])
})

test('padrão que roda em qualquer site exige confirmação explícita', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirScripts(app)
  await app.ui.getByRole('button', { name: 'Script em branco' }).click()

  const padroes = app.ui.getByPlaceholder(/Padrões de URL/)
  await padroes.fill('*')
  await expect(app.ui.getByText(/este padrão roda em todos os sites/)).toBeVisible()

  await app.ui.getByRole('button', { name: 'Salvar' }).click()
  await expect(app.ui.getByText('Rodar em todos os sites?')).toBeVisible({ timeout: 15_000 })

  // cancelar não pode salvar nada
  await app.ui.getByRole('button', { name: 'Cancelar' }).click()
  await expect(app.ui.getByText('Rodar em todos os sites?')).toHaveCount(0)
  expect(app.readStore<UserScript>('userscripts'), 'cancelar não grava').toHaveLength(0)

  // o atalho do diálogo limita o script à página atual
  await app.ui.getByRole('button', { name: 'Salvar' }).click()
  await expect(app.ui.getByText('Rodar em todos os sites?')).toBeVisible({ timeout: 15_000 })
  await app.ui.getByRole('button', { name: /^Limitar a / }).click()
  await expect(padroes).toHaveValue(`${new URL(site.url('/')).origin}/*`)
  expect(app.readStore<UserScript>('userscripts'), 'limitar também não grava sozinho').toHaveLength(0)
})

test('confirmando, o script amplo é salvo e fica marcado como tal', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await abrirScripts(app)
  await app.ui.getByRole('button', { name: 'Script em branco' }).click()
  await app.ui.getByPlaceholder(/Padrões de URL/).fill('*')
  await app.ui.getByRole('button', { name: 'Salvar' }).click()
  await app.ui.getByRole('button', { name: 'Rodar em tudo' }).click()

  await expect(app.ui.getByText('Script salvo')).toBeVisible({ timeout: 15_000 })
  expect(app.readStore<UserScript>('userscripts')[0].matches).toEqual(['*'])
  await expect(app.ui.getByLabel('roda em todos os sites')).toBeVisible()
})

test('a lista mostra quais scripts rodam na página em que você está', async () => {
  const outro = await new FixtureSite().set('/', PAGINA).start()
  try {
    app = await launchApp({
      startUrl: site.url('/'),
      seed: {
        scripts: [
          userScript('void 0', { name: 'daqui', matches: [`${new URL(site.url('/')).origin}/*`] }),
          userScript('void 0', { name: 'de outro lugar', matches: [`${new URL(outro.url('/')).origin}/*`] })
        ]
      }
    })
    await abrirScripts(app)

    const marcador = (nome: string) =>
      app!.ui
        .locator('div', { has: app!.ui.getByText(nome, { exact: true }) })
        .last()
        .getByTitle('roda nesta página')

    await expect(marcador('daqui')).toBeVisible({ timeout: 15_000 })
    await expect(marcador('de outro lugar')).toHaveCount(0)
  } finally {
    await outro.stop()
  }
})
