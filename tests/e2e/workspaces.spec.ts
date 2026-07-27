import { expect, test } from '@playwright/test'
import { editOverride, launchApp, userScript, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'
import type { OverrideEntry, UserScript, Workspace } from '../../src/shared/schemas'

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

test('salvar, apagar e restaurar devolve overrides, scripts e regras', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      overrides: [
        editOverride(site.url('/app.js'), 'const a = 1', 'const a = 2', {
          pattern: site.url('/app.*.js')
        })
      ],
      scripts: [userScript('console.log("oi")', { name: 'meu-script' })],
      rules: [{ id: 'r1', pattern: '*analytics*', action: 'block', enabled: true }]
    }
  })

  await app.openPanel('Sessões')
  await app.ui.getByPlaceholder('Nome da sessão atual…').fill('minha-sessao')
  await app.ui.getByRole('button', { name: 'Salvar atual' }).click()

  await expect.poll(() => app!.readStore<Workspace>('workspaces').length, { timeout: 15_000 }).toBe(1)
  const salva = app.readStore<Workspace>('workspaces')[0]
  expect(salva.name).toBe('minha-sessao')
  expect(salva.overrides).toHaveLength(1)
  expect(salva.scripts).toHaveLength(1)
  expect(salva.rules).toHaveLength(1)

  // limpa tudo
  await app.ui.evaluate(async () => {
    const overrides = await window.api.overrides.list()
    await Promise.all(overrides.map((o) => window.api.overrides.remove(o.id)))
    const scripts = await window.api.scripts.list()
    await Promise.all(scripts.map((s) => window.api.scripts.remove(s.id)))
    const rules = await window.api.rules.list()
    await Promise.all(rules.map((r) => window.api.rules.remove(r.id)))
  })
  await expect.poll(() => app!.readStore('overrides').length, { timeout: 15_000 }).toBe(0)

  await app.ui.getByTitle('Restaurar esta sessão').click()
  await app.ui.getByRole('button', { name: 'Restaurar', exact: true }).click()

  await expect.poll(() => app!.readStore<OverrideEntry>('overrides').length, { timeout: 15_000 }).toBe(1)
  const restaurado = app.readStore<OverrideEntry>('overrides')[0]
  expect(restaurado.pattern, 'o glob precisa sobreviver ao ciclo').toBe(site.url('/app.*.js'))
  expect(restaurado.editedText).toBe('const a = 2')
  expect(app.readStore<UserScript>('userscripts')[0]?.name).toBe('meu-script')
  expect(app.readStore('netrules')).toHaveLength(1)
})

test('restaurar avisa que substitui o estado atual', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      workspaces: [
        { id: 'w1', name: 'outra-sessao', createdAt: Date.now(), overrides: [], scripts: [], rules: [] }
      ],
      overrides: [editOverride(site.url('/x.js'), 'a', 'b')]
    }
  })

  await app.openPanel('Sessões')
  await app.ui.getByTitle('Restaurar esta sessão').click()
  await expect(app.ui.getByText(/substitui/i)).toBeVisible()

  // cancelar não pode mexer no estado
  await app.ui.getByRole('button', { name: 'Cancelar' }).click()
  expect(app.readStore('overrides')).toHaveLength(1)
})
