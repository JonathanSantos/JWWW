import { expect, test } from '@playwright/test'
import { launchApp, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const PAINEIS = ['Recursos', 'Rede', 'Editor', 'Scripts', 'Overrides', 'Bus', 'Sessões']

const INDEX =
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>painéis</title>` +
  `<link rel="stylesheet" href="/assets/css/main.css">` +
  `<script src="/assets/js/vendor/app.js"></script></head><body></body></html>`

let site: FixtureSite
let app: JwwwApp | null = null

test.beforeEach(async () => {
  site = await new FixtureSite()
    .set('/', INDEX)
    .set('/assets/css/main.css', '.a{color:red}', 'text/css')
    .js('/assets/js/vendor/app.js', 'window.__ok = 1')
    .start()
})

test.afterEach(async () => {
  await app?.close()
  app = null
  await site.stop()
})

test('todos os painéis abrem sem estourar o error boundary', async () => {
  app = await launchApp({ startUrl: site.url('/') })

  for (const nome of PAINEIS) {
    await app.openPanel(nome)
    await expect(app.ui.getByRole('tab', { name: nome, exact: true })).toHaveAttribute(
      'data-state',
      'active'
    )
    await expect(app.ui.getByText(`O painel ${nome} falhou`)).toHaveCount(0)
    const conteudo = await app.ui.locator('[role="tabpanel"][data-state="active"]').innerText()
    expect(conteudo.trim().length, `${nome} não pode renderizar vazio`).toBeGreaterThan(0)
  }
})

test('a árvore de recursos separa domínio próprio e aninha pastas', async () => {
  app = await launchApp({ startUrl: site.url('/') })
  await app.openPanel('Recursos')

  await expect(app.ui.getByText('Este domínio')).toBeVisible({ timeout: 20_000 })
  // localhost fica fora da lista pública de sufixos; ainda assim é o domínio da página
  await expect(app.ui.getByText('localhost', { exact: true }).first()).toBeVisible()

  // js/vendor tem um filho só e deve aparecer colapsado num nó
  await expect(app.ui.getByText('js/vendor')).toBeVisible({ timeout: 20_000 })
  await expect(app.ui.locator('[title="' + site.url('/assets/js/vendor/app.js') + '"]')).toBeVisible()
  await expect(app.ui.locator('[title="' + site.url('/assets/css/main.css') + '"]')).toBeVisible()
})

test('regra de bloqueio impede a requisição', async () => {
  app = await launchApp({
    startUrl: site.url('/'),
    seed: { rules: [{ id: 'r1', pattern: '*vendor*', action: 'block', enabled: true }] }
  })

  const carregou = await app.pageEval<boolean>('window.__ok === 1')
  expect(carregou, 'o script bloqueado não pode ter executado').toBe(false)

  await app.openPanel('Rede')
  await expect(app.ui.getByText('BLK').first()).toBeVisible({ timeout: 20_000 })
})
