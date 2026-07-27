import { expect, test } from '@playwright/test'
import { launchApp, userScript, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  site = await new FixtureSite().set('/', '<!doctype html><meta charset="utf-8"><h1>fixture</h1>').start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

test('userscript roda no mundo da página e publica no bus', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(
          `window.__rodou = true
           jwww.bus.emit('do-script', { origem: location.hostname, acento: 'ção ✅' })`
        )
      ]
    }
  })

  await expect.poll(() => app!.pageEval<boolean>('window.__rodou === true'), { timeout: 25_000 }).toBe(true)

  const recebidas = await app.ui.evaluate(() => window.api.bus.history())
  const msg = recebidas.find((m) => m.topic === 'do-script')
  expect(msg, 'a mensagem do userscript deve chegar ao processo main').toBeTruthy()
  expect((msg!.data as { acento: string }).acento, 'acentuação preservada no IPC').toBe('ção ✅')
  expect(msg!.from.origin).toBe(new URL(site.url('/')).origin)
})

test('mensagem publicada pela UI chega na página', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(`window.__recebido = null
                    jwww.bus.on('da-ui', (m) => { window.__recebido = m.data })`)
      ]
    }
  })
  await app.pageEval('window.__recebido')

  await app.ui.evaluate(() => window.api.bus.emit('da-ui', { ok: 1 }))
  await expect
    .poll(() => app!.pageEval<unknown>('window.__recebido && window.__recebido.ok'), { timeout: 20_000 })
    .toBe(1)
})
