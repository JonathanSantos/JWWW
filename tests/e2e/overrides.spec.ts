import { expect, test } from '@playwright/test'
import { editOverride, launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { OverrideEntry } from '../../src/shared/schemas'

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

test('o estado de cada override sobrevive a uma enxurrada de eventos', async () => {
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

  // O histórico de status é uma fila curta. Recarregar várias vezes empurra os
  // eventos antigos para fora dela — o estado atual do override não pode sumir
  // junto, que era o que acontecia quando o badge lia da fila.
  for (let i = 0; i < 3; i++) await app.reloadPage()

  await app.openPanel('Overrides')
  await expect(app.ui.getByText('aplicado')).toBeVisible({ timeout: 15_000 })
  await expect(app.ui.getByText(/1 de 1 ativo/)).toBeVisible()
})

test('a árvore de recursos distingue aplicado de falhou', async () => {
  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('producao', 'SOBRESCRITO'))]
    }
  })
  await app.openPanel('Recursos')
  await expect(app.ui.getByText('override', { exact: true })).toBeVisible({ timeout: 25_000 })

  // "deploy" que quebra a âncora: o arquivo tem que ficar marcado como falhou,
  // e não voltar a ficar sem marca nenhuma (o original é servido em silêncio).
  site.js('/app.js', `(function(){ var outraCoisa = { modo: "homologacao" }; })();`)
  await app.reloadPage()

  await expect(app.ui.getByText('falhou', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(app.ui.getByText('override', { exact: true })).toHaveCount(0)
})

test('interruptor geral desliga tudo, recarrega e volta atrás', async () => {
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

  await app.openPanel('Overrides')
  await app.ui.getByRole('button', { name: 'Desligar tudo' }).click()

  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('producao')
  expect(app.readStore<OverrideEntry>('overrides')[0].enabled, 'o override continua existindo').toBe(false)

  await app.ui.getByRole('button', { name: 'Religar tudo' }).click()
  await expect
    .poll(() => app!.pageEval<string>('document.body.textContent'), { timeout: 25_000 })
    .toContain('SOBRESCRITO')
})

test('copiar e colar um override cria outro, sem sobrescrever o primeiro', async () => {
  const original = site.bodyOf('/app.js')
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [editOverride(site.url('/app.js'), original, original.replace('producao', 'SOBRESCRITO'))]
    }
  })
  await app.openPanel('Overrides')
  await app.ui.getByTitle(/Copiar este override/).click()
  await expect(app.ui.getByText('Override copiado')).toBeVisible({ timeout: 15_000 })

  await app.ui.getByTitle('Colar um override copiado').click()
  await expect(app.ui.getByText('Override colado')).toBeVisible({ timeout: 15_000 })

  const salvos = app.readStore<OverrideEntry>('overrides')
  expect(salvos).toHaveLength(2)
  expect(salvos[0].id, 'o colado ganha id próprio').not.toBe(salvos[1].id)
  expect(salvos[1].editedText).toBe(salvos[0].editedText)
})
