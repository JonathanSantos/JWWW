import { expect, test } from '@playwright/test'
import { editOverride, launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const APP_JS = `(function(){
  var cfg = { ambiente: "producao" };
  document.addEventListener("DOMContentLoaded", function () {
    document.body.innerHTML = "<h1 id='t'>" + cfg.ambiente + "</h1>";
  });
})();`

const INDEX = (src: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>fixture</title>` +
  `<script src="${src}"></script></head><body></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  site = await new FixtureSite().set('/', INDEX('/app.js')).js('/app.js', APP_JS).start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

test('aplica o override já no primeiro carregamento, sem reload manual', async () => {
  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('producao', 'SOBRESCRITO'))]
    }
  })

  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('SOBRESCRITO')
})

test('preserva acentos e emoji ao reescrever o corpo', async () => {
  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('producao', 'Ação ✅ válida'))]
    }
  })

  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('Ação ✅ válida')
})

test('quando o site muda e o patch não aplica, serve o original e a página segue viva', async () => {
  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('producao', 'SOBRESCRITO'))]
    }
  })
  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('SOBRESCRITO')

  // "deploy": o trecho ancorado deixa de existir
  site.js(
    '/app.js',
    `(function(){
      var configuracoesNovas = { modo: "homologacao" };
      document.addEventListener("DOMContentLoaded", function () {
        document.body.innerHTML = "<h1 id='t'>" + configuracoesNovas.modo + "</h1>";
      });
    })();`
  )
  await app.reloadPage()

  const texto = await app.pageEval<string>('document.body.textContent')
  expect(texto, 'a página não pode quebrar quando o override falha').toContain('homologacao')
  expect(texto).not.toContain('SOBRESCRITO')

  await app.openPanel('Overrides')
  await expect(app.ui.getByText(/falhou|fuzzy/)).toBeVisible()
})
