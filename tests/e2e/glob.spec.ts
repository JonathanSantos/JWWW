import { expect, test } from '@playwright/test'
import { editOverride, launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const bundle = (rotulo: string) =>
  `(function(){
  var cfg = { ambiente: "${rotulo}" };
  document.addEventListener("DOMContentLoaded", function () {
    document.body.innerHTML = "<h1>" + cfg.ambiente + "</h1>";
  });
})();`

const index = (src: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>fixture</title>` +
  `<script src="${src}"></script></head><body></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.afterEach(async () => {
  await app?.close()
  app = null
  await site?.stop()
})

test('override com glob sobrevive a deploy que troca o hash do bundle', async () => {
  site = await new FixtureSite()
    .set('/', index('/assets/app.a3f9b1.js'))
    .js('/assets/app.a3f9b1.js', bundle('ANTES'))
    .start()

  const original = site.bodyOf('/assets/app.a3f9b1.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [
        editOverride(
          site.url('/assets/app.a3f9b1.js'),
          original,
          original.replace('DOMContentLoaded', 'DOMContentLoaded') + '\n/*MARCA_DO_OVERRIDE*/',
          { pattern: site.url('/assets/app.*.js') }
        )
      ]
    }
  })

  const antes = await app.pageEval<string>(
    `(async () => (await (await fetch(document.querySelector('script').src)).text()))()`
  )
  expect(antes, 'override deve valer antes do deploy').toContain('MARCA_DO_OVERRIDE')

  // deploy: novo hash no nome E conteúdo diferente
  site.rename('/assets/app.a3f9b1.js', '/assets/app.ff0099.js')
  site.js('/assets/app.ff0099.js', bundle('DEPOIS'))
  site.set('/', index('/assets/app.ff0099.js'))
  await app.reloadPage()

  const src = await app.pageEval<string>(`document.querySelector('script').getAttribute('src')`)
  expect(src, 'a página deve carregar o bundle novo').toContain('ff0099')

  const depois = await app.pageEval<string>(
    `(async () => (await (await fetch(document.querySelector('script').src)).text()))()`
  )
  expect(depois, 'o override deve continuar valendo no arquivo renomeado').toContain('MARCA_DO_OVERRIDE')
  expect(depois, 'e sobre o conteúdo novo do servidor').toContain('DEPOIS')
})

test('sem glob, o mesmo override para de valer após o deploy', async () => {
  site = await new FixtureSite()
    .set('/', index('/assets/app.a3f9b1.js'))
    .js('/assets/app.a3f9b1.js', bundle('ANTES'))
    .start()

  const original = site.bodyOf('/assets/app.a3f9b1.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [
        editOverride(site.url('/assets/app.a3f9b1.js'), original, original + '\n/*MARCA_DO_OVERRIDE*/')
      ]
    }
  })

  site.rename('/assets/app.a3f9b1.js', '/assets/app.ff0099.js')
  site.set('/', index('/assets/app.ff0099.js'))
  await app.reloadPage()

  const depois = await app.pageEval<string>(
    `(async () => (await (await fetch(document.querySelector('script').src)).text()))()`
  )
  expect(depois, 'URL exata não deve casar o bundle renomeado').not.toContain('MARCA_DO_OVERRIDE')
})
