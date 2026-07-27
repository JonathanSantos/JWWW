import { expect, test } from '@playwright/test'
import { editOverride, launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const APP_JS = `(function(){
  document.addEventListener("DOMContentLoaded", function () {
    document.body.innerHTML = "<h1>ORIGINAL</h1>";
  });
})();`

let site: FixtureSite
let app: JwwwApp | null = null

test.afterEach(async () => {
  await app?.close()
  app = null
  await site?.stop()
})

test('remove integrity do recurso com override para o script poder rodar', async () => {
  site = await new FixtureSite().js('/app.js', APP_JS)
  const hash = site.sri('/app.js')
  site.set(
    '/',
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>sri</title>` +
      `<script src="/app.js" integrity="${hash}" crossorigin="anonymous"></script></head><body></body></html>`
  )
  await site.start()

  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('ORIGINAL', 'PASSOU PELO SRI'))]
    }
  })

  // Sem o strip do integrity o browser bloquearia o script e o body ficaria vazio.
  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('PASSOU PELO SRI')

  const html = await app.pageEval<string>('document.documentElement.outerHTML')
  expect(html, 'o atributo integrity deve ter sido removido da tag').not.toContain('integrity=')
})

test('mantém integrity nas tags sem override', async () => {
  site = await new FixtureSite().js('/app.js', APP_JS).js('/outro.js', 'window.__outro = 1;')
  const hashOutro = site.sri('/outro.js')
  site.set(
    '/',
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>sri</title>` +
      `<script src="/app.js"></script>` +
      `<script src="/outro.js" integrity="${hashOutro}" crossorigin="anonymous"></script>` +
      `</head><body></body></html>`
  )
  await site.start()

  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('ORIGINAL', 'EDITADO'))]
    }
  })

  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('EDITADO')

  const html = await app.pageEval<string>('document.documentElement.outerHTML')
  expect(html, 'o SRI do recurso sem override deve continuar protegendo a página').toContain(hashOutro)
})
