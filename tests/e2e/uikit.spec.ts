import { expect, test } from '@playwright/test'
import { launchApp, userScript, type JwwwApp } from './helpers/app'
import { FixtureSite } from './helpers/server'

const PAGINA = (titulo: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>` +
  `<style>body{background:#fff;color:#111;font-family:sans-serif} .jw-cartao{display:none !important}</style>` +
  `</head><body><h1>${titulo}</h1></body></html>`

let site: FixtureSite
let outro: FixtureSite | null = null
let app: JwwwApp | null = null

test.afterEach(async () => {
  await app?.close()
  app = null
  await site?.stop()
  await outro?.stop()
  outro = null
})

/** Lê de dentro do shadow root do painel — é lá que a UI do toolkit vive. */
const noPainel = (id: string, expressao: string) =>
  `(() => {
    const host = document.querySelector('[data-jwww-ui="${id}"]');
    if (!host) return null;
    const raiz = host.shadowRoot;
    return ${expressao};
  })()`

test('monta um painel em shadow DOM sem sofrer com o CSS do site', async () => {
  site = await new FixtureSite().set('/', PAGINA('site')).start()
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(`const p = jwww.ui.sidebar({ id: 'teste', titulo: 'Painel', botao: '🛠' })
          p.render(({ html }) => html\`<h3 id="oi">olá \${location.hostname}</h3>\`)`)
      ]
    }
  })

  await expect
    .poll(() => app!.pageEval<number>(`document.querySelectorAll('[data-jwww-ui="teste"]').length`), {
      timeout: 25_000
    })
    .toBe(1)

  const titulo = await app.pageEval<string | null>(
    noPainel('teste', `raiz.querySelector('.jw-titulo')?.textContent ?? null`)
  )
  expect(titulo).toBe('Painel')

  const conteudo = await app.pageEval<string | null>(
    noPainel('teste', `raiz.querySelector('#oi')?.textContent ?? null`)
  )
  expect(conteudo).toContain('olá')

  // o site declara `.jw-cartao { display: none }`; o shadow DOM protege o painel
  const visivel = await app.pageEval<boolean>(
    noPainel('teste', `getComputedStyle(raiz.querySelector('.jw-cartao')).display !== 'none'`)
  )
  expect(visivel, 'o CSS do site não pode vazar para dentro do painel').toBe(true)

  // e o painel não deixa nada solto no documento do site
  const vazamento = await app.pageEval<number>(`document.querySelectorAll('.jw-cartao, .jw-fab').length`)
  expect(vazamento, 'nada do painel deve existir fora do shadow root').toBe(0)
})

test('estado reativo re-renderiza e eventos funcionam', async () => {
  site = await new FixtureSite().set('/', PAGINA('site')).start()
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(`const n = jwww.ui.estado(0)
          const p = jwww.ui.painel({ id: 'contador', titulo: 'Contador' })
          p.render(({ html }) => html\`
            <span id="valor">\${n.get()}</span>
            <button id="mais" onclick=\${() => n.mude((v) => v + 1)}>+</button>
          \`)`)
      ]
    }
  })

  await expect
    .poll(() => app!.pageEval<string | null>(noPainel('contador', `raiz.querySelector('#valor')?.textContent ?? null`)), {
      timeout: 25_000
    })
    .toBe('0')

  await app.pageEval(noPainel('contador', `raiz.querySelector('#mais').click()`))
  await app.pageEval(noPainel('contador', `raiz.querySelector('#mais').click()`))

  await expect
    .poll(() => app!.pageEval<string | null>(noPainel('contador', `raiz.querySelector('#valor')?.textContent ?? null`)))
    .toBe('2')
})

test('interpolação escapa HTML vindo do site', async () => {
  site = await new FixtureSite().set('/', PAGINA('site')).start()
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(`const p = jwww.ui.painel({ id: 'escape', titulo: 'Escape' })
          const perigoso = '<img src=x onerror="window.__invadido = true">'
          p.render(({ html }) => html\`<div id="alvo">\${perigoso}</div>\`)`)
      ]
    }
  })

  await expect
    .poll(() => app!.pageEval<string | null>(noPainel('escape', `raiz.querySelector('#alvo')?.textContent ?? null`)), {
      timeout: 25_000
    })
    .toContain('<img')

  const imagens = await app.pageEval<number>(noPainel('escape', `raiz.querySelectorAll('img').length`))
  expect(imagens, 'o HTML interpolado tem que virar texto, não elemento').toBe(0)
  expect(await app.pageEval<boolean>(`window.__invadido === true`)).toBe(false)
})

test('lê um valor exposto do bundle e mostra no painel', async () => {
  site = await new FixtureSite()
    .set('/', PAGINA('site'))
    .js('/app.js', `setTimeout(() => { globalThis.estadoDoApp = { itens: 3, dono: 'site' } }, 300)`)
    .start()
  site.set(
    '/',
    PAGINA('site').replace('</head>', '<script src="/app.js"></script></head>')
  )

  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(`const p = jwww.ui.painel({ id: 'espelho', titulo: 'Espelho' })
          const v = jwww.ui.estado(null)
          jwww.globals.get('estadoDoApp').then((x) => v.set(x))
          p.render(({ html }) => html\`<pre id="saida">\${JSON.stringify(v.get())}</pre>\`)`)
      ]
    }
  })

  // o valor só aparece 300ms depois: o toolkit precisa esperar
  await expect
    .poll(() => app!.pageEval<string | null>(noPainel('espelho', `raiz.querySelector('#saida')?.textContent ?? null`)), {
      timeout: 25_000
    })
    .toContain('"itens":3')
})

test('estado compartilhado sincroniza entre abas de domínios diferentes', async () => {
  site = await new FixtureSite().set('/', PAGINA('site-a')).start()
  outro = await new FixtureSite().set('/', PAGINA('site-b')).start()

  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(`const notas = jwww.compartilhado('notas', [])
          globalThis.__notas = notas
          const p = jwww.ui.painel({ id: 'notas', titulo: 'Notas' })
          p.render(({ html }) => html\`<span id="qtd">\${notas.get().length}</span>\`)`)
      ]
    }
  })

  await expect
    .poll(() => app!.pageEval<string | null>(noPainel('notas', `raiz.querySelector('#qtd')?.textContent ?? null`)), {
      timeout: 25_000
    })
    .toBe('0')

  const portaOutro = new URL(outro.url('/')).port
  await app.openTab(outro.url('/'))
  await expect
    .poll(
      () =>
        app!.pageEval<string | null>(
          noPainel('notas', `raiz.querySelector('#qtd')?.textContent ?? null`),
          portaOutro
        ),
      { timeout: 25_000 }
    )
    .toBe('0')

  // escreve na aba B…
  await app.pageEval(`__notas.mude((l) => [...l, { texto: 'da aba B' }])`, portaOutro)

  // …e a aba A, de outra origem, reflete
  const portaA = new URL(site.url('/')).port
  await expect
    .poll(
      () => app!.pageEval<string | null>(noPainel('notas', `raiz.querySelector('#qtd')?.textContent ?? null`), portaA),
      { timeout: 25_000 }
    )
    .toBe('1')

  const conteudo = await app.pageEval<string>(`JSON.stringify(__notas.get())`, portaA)
  expect(conteudo).toContain('da aba B')
})

test('rpc chama uma função de outra aba e recebe a resposta', async () => {
  site = await new FixtureSite().set('/', PAGINA('atendente')).start()
  outro = await new FixtureSite().set('/', PAGINA('chamador')).start()

  // O atendente roda só no site A: RPC é broadcast e quem responde primeiro
  // ganha, então deixar as duas abas atendendo tornaria o teste ambíguo.
  app = await launchApp({
    startUrl: site.url('/'),
    seed: {
      scripts: [
        userScript(
          `jwww.rpc.atender('titulo', () => document.title)
           jwww.rpc.atender('somar', (a, b) => a + b)`,
          { matches: [site.url('/') + '*'] }
        )
      ]
    }
  })
  await expect
    .poll(() => app!.pageEval<string>(`typeof jwww.rpc.chamar`), { timeout: 25_000 })
    .toBe('function')

  const portaOutro = new URL(outro.url('/')).port
  await app.openTab(outro.url('/'))

  const titulo = await app.pageEval<string>(`jwww.rpc.chamar('titulo')`, portaOutro)
  expect(titulo, 'a aba B recebeu o título da aba A').toBe('atendente')

  const soma = await app.pageEval<number>(`jwww.rpc.chamar('somar', 2, 40)`, portaOutro)
  expect(soma).toBe(42)

  const erro = await app.pageEval<string>(
    `jwww.rpc.chamar('inexistente').then(() => 'resolveu', (e) => e.message)`,
    portaOutro
  )
  expect(erro, 'método sem atendente falha com mensagem clara').toContain('ninguém atendeu')
})
