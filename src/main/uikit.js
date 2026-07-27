/**
 * Toolkit de UI do JWWW — injetado no mundo da página, disponível em `jwww.ui`.
 *
 * A ideia é ser um framework mínimo dentro do navegador: você monta um painel
 * em qualquer site sem brigar com o CSS dele (shadow DOM), e liga esse painel
 * às outras features — valores arrancados do bundle com "Expor global", estado
 * replicado entre abas de domínios diferentes, e chamada de função entre abas.
 *
 * Este arquivo é JS puro de propósito: ele é injetado como texto, então não
 * passa por build. Sem otimizações espertas, sem sintaxe recente demais.
 */
;(() => {
  if (globalThis.jwww && globalThis.jwww.ui) return

  var PREFIXO_EVENTO = 'data-jwww-on-'
  var Z_INDEX = 2147483000

  // ---------------------------------------------------------------- reativo

  var efeitoAtual = null

  function criarSinal(inicial) {
    var valor = inicial
    var assinantes = new Set()
    return {
      get: function () {
        if (efeitoAtual) assinantes.add(efeitoAtual)
        return valor
      },
      set: function (novo) {
        if (novo === valor) return
        valor = novo
        // cópia: um efeito pode se re-registrar durante a notificação
        // (Array.from, não slice.call: Set não é array-like e viraria [])
        Array.from(assinantes).forEach(function (f) {
          try {
            f()
          } catch (e) {
            console.error('[jwww.ui] efeito falhou:', e)
          }
        })
      },
      assinar: function (fn) {
        assinantes.add(fn)
        return function () {
          assinantes.delete(fn)
        }
      }
    }
  }

  /** Roda `fn` e re-roda sempre que um sinal lido por ela mudar. */
  function efeito(fn) {
    var rodar = function () {
      var anterior = efeitoAtual
      efeitoAtual = rodar
      try {
        fn()
      } finally {
        efeitoAtual = anterior
      }
    }
    rodar()
    return rodar
  }

  function estado(inicial) {
    var sinal = criarSinal(inicial)
    return {
      get: sinal.get,
      set: sinal.set,
      /** atualiza a partir do valor atual: `.mude(v => v + 1)` */
      mude: function (fn) {
        sinal.set(fn(sinal.get()))
      },
      assinar: sinal.assinar
    }
  }

  // ------------------------------------------------------------- templates

  function escapar(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function cru(texto) {
    return { __jwwwCru: String(texto) }
  }

  /**
   * `html` interpola valores escapando por padrão. Função em posição de
   * atributo de evento (`onclick=${fn}`) vira um listener de verdade depois da
   * renderização — sem `eval`, sem string de código.
   */
  function html(partes) {
    var valores = Array.prototype.slice.call(arguments, 1)
    var saida = ''
    var handlers = []

    for (var i = 0; i < partes.length; i++) {
      saida += partes[i]
      if (i >= valores.length) continue
      var v = valores[i]

      var atributoDeEvento = saida.match(/\son([a-zA-Z]+)\s*=\s*$/)
      if (typeof v === 'function' && atributoDeEvento) {
        var chave = String(handlers.length)
        handlers.push(v)
        saida = saida.slice(0, atributoDeEvento.index)
        saida += ' ' + PREFIXO_EVENTO + atributoDeEvento[1].toLowerCase() + '="' + chave + '"'
        continue
      }

      if (v === null || v === undefined || v === false) continue
      if (Array.isArray(v)) {
        saida += v
          .map(function (item) {
            if (item && item.__jwwwHtml) return item.html
            if (item && item.__jwwwCru) return item.__jwwwCru
            return escapar(item)
          })
          .join('')
        continue
      }
      if (v && v.__jwwwHtml) {
        // template aninhado: reindexa os handlers dele
        var deslocamento = handlers.length
        saida += v.html.replace(
          new RegExp(PREFIXO_EVENTO + '([a-z]+)="(\\d+)"', 'g'),
          function (_todo, evento, indice) {
            return PREFIXO_EVENTO + evento + '="' + (Number(indice) + deslocamento) + '"'
          }
        )
        handlers = handlers.concat(v.handlers)
        continue
      }
      if (v && v.__jwwwCru) {
        saida += v.__jwwwCru
        continue
      }
      saida += escapar(v)
    }

    return { __jwwwHtml: true, html: saida, handlers: handlers }
  }

  function ligarEventos(raiz, handlers) {
    var elementos = raiz.querySelectorAll('*')
    for (var i = 0; i < elementos.length; i++) {
      var el = elementos[i]
      var atributos = Array.prototype.slice.call(el.attributes)
      for (var j = 0; j < atributos.length; j++) {
        var attr = atributos[j]
        if (attr.name.indexOf(PREFIXO_EVENTO) !== 0) continue
        var evento = attr.name.slice(PREFIXO_EVENTO.length)
        var fn = handlers[Number(attr.value)]
        el.removeAttribute(attr.name)
        if (typeof fn === 'function') el.addEventListener(evento, fn)
      }
    }
  }

  // -------------------------------------------------------------- aparência

  var CSS_BASE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .jw-raiz {
      position: fixed; z-index: ${Z_INDEX};
      color: #e4e4e7; font-size: 13px; line-height: 1.45;
    }
    .jw-cartao {
      background: #18181b; border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.45);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .jw-topo {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08);
      font-weight: 600; font-size: 12px; letter-spacing: .02em;
    }
    .jw-topo .jw-titulo { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .jw-fechar {
      all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px;
      color: #a1a1aa; font-size: 14px; line-height: 1;
    }
    .jw-fechar:hover { background: rgba(255,255,255,.08); color: #fff; }
    .jw-corpo { padding: 12px; overflow: auto; flex: 1; }
    .jw-fab {
      all: unset; cursor: pointer; position: fixed; z-index: ${Z_INDEX};
      width: 44px; height: 44px; border-radius: 999px;
      background: #18181b; border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 8px 24px rgba(0,0,0,.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: #e4e4e7; transition: transform .12s ease;
    }
    .jw-fab:hover { transform: scale(1.06); }
    button, .jw-botao {
      all: unset; cursor: pointer; padding: 5px 10px; border-radius: 7px;
      background: #27272a; color: #e4e4e7; font-size: 12px;
      border: 1px solid rgba(255,255,255,.08);
    }
    button:hover, .jw-botao:hover { background: #3f3f46; }
    input, textarea, select {
      all: unset; box-sizing: border-box; width: 100%;
      padding: 5px 8px; border-radius: 7px; background: #27272a;
      border: 1px solid rgba(255,255,255,.1); color: #e4e4e7; font-size: 12px;
    }
    h1,h2,h3,h4 { margin: 0 0 6px; font-weight: 600; }
    h3 { font-size: 13px; } h4 { font-size: 12px; color: #a1a1aa; }
    p { margin: 0 0 6px; } a { color: #7dd3fc; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    td, th { text-align: left; padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,.07); }
  `

  function chaveDeArmazenamento(id) {
    return '__jwww:ui:' + id
  }

  function lerAberto(id, padrao) {
    try {
      var v = localStorage.getItem(chaveDeArmazenamento(id))
      return v === null ? padrao : v === '1'
    } catch (e) {
      return padrao
    }
  }

  function gravarAberto(id, aberto) {
    try {
      localStorage.setItem(chaveDeArmazenamento(id), aberto ? '1' : '0')
    } catch (e) {}
  }

  // ---------------------------------------------------------------- painéis

  var montados = new Map()

  function criarSuperficie(opcoes) {
    var id = opcoes.id || 'jwww-' + Math.random().toString(36).slice(2, 8)
    if (montados.has(id)) montados.get(id).destruir()

    var hospedeiro = document.createElement('div')
    hospedeiro.setAttribute('data-jwww-ui', id)
    var raiz = hospedeiro.attachShadow({ mode: 'open' })
    var estilo = document.createElement('style')
    estilo.textContent = CSS_BASE + (opcoes.css || '')
    raiz.appendChild(estilo)

    var container = document.createElement('div')
    container.className = 'jw-raiz'
    raiz.appendChild(container)
    ;(document.body || document.documentElement).appendChild(hospedeiro)

    return { id: id, hospedeiro: hospedeiro, raiz: raiz, container: container }
  }

  /** Guarda e devolve o foco entre renderizações, para não atrapalhar quem digita. */
  function preservandoFoco(raiz, fn) {
    var ativo = raiz.activeElement
    var idAtivo = ativo && ativo.id
    var inicio = ativo && ativo.selectionStart
    var fim = ativo && ativo.selectionEnd
    fn()
    if (!idAtivo) return
    var novo = raiz.getElementById ? raiz.getElementById(idAtivo) : raiz.querySelector('#' + idAtivo)
    if (!novo) return
    try {
      novo.focus()
      if (inicio !== null && inicio !== undefined && novo.setSelectionRange) {
        novo.setSelectionRange(inicio, fim)
      }
    } catch (e) {}
  }

  function montarPainel(opcoes, layout) {
    var s = criarSuperficie(opcoes)
    var aberto = criarSinal(lerAberto(s.id, opcoes.aberto !== false))
    var conteudo = document.createElement('div')
    conteudo.className = 'jw-corpo'

    var cartao = document.createElement('div')
    cartao.className = 'jw-cartao'
    if (opcoes.titulo !== null) {
      var topo = document.createElement('div')
      topo.className = 'jw-topo'
      var titulo = document.createElement('div')
      titulo.className = 'jw-titulo'
      titulo.textContent = opcoes.titulo || 'JWWW'
      var fechar = document.createElement('button')
      fechar.className = 'jw-fechar'
      fechar.textContent = '×'
      fechar.title = 'fechar'
      fechar.addEventListener('click', function () {
        api.fechar()
      })
      topo.appendChild(titulo)
      topo.appendChild(fechar)
      cartao.appendChild(topo)
    }
    cartao.appendChild(conteudo)
    s.container.appendChild(cartao)
    layout(s.container, cartao)

    var botao = null
    if (opcoes.botao) {
      botao = document.createElement('button')
      botao.className = 'jw-fab'
      botao.textContent = opcoes.botao
      botao.title = opcoes.titulo || 'JWWW'
      botao.style.bottom = '20px'
      botao.style[opcoes.lado === 'esquerda' ? 'left' : 'right'] = '20px'
      botao.addEventListener('click', function () {
        api.alternar()
      })
      s.raiz.appendChild(botao)
    }

    var pararEfeito = null

    var api = {
      id: s.id,
      raiz: s.raiz,
      corpo: conteudo,
      aberto: aberto.get,
      abrir: function () {
        aberto.set(true)
        gravarAberto(s.id, true)
      },
      fechar: function () {
        aberto.set(false)
        gravarAberto(s.id, false)
      },
      alternar: function () {
        var novo = !aberto.get()
        aberto.set(novo)
        gravarAberto(s.id, novo)
      },
      /** Define o que desenhar. Re-executa sozinho quando um estado lido muda. */
      render: function (fn) {
        if (pararEfeito) pararEfeito = null
        efeito(function () {
          var resultado = fn({ html: html, cru: cru, painel: api })
          if (!resultado) return
          var marcacao = resultado.__jwwwHtml ? resultado : html`${resultado}`
          preservandoFoco(s.raiz, function () {
            conteudo.innerHTML = marcacao.html
            ligarEventos(conteudo, marcacao.handlers)
          })
        })
        return api
      },
      destruir: function () {
        montados.delete(s.id)
        s.hospedeiro.remove()
      }
    }

    // visibilidade é reativa: abrir/fechar de qualquer lugar reflete na tela
    efeito(function () {
      cartao.style.display = aberto.get() ? 'flex' : 'none'
      if (botao) botao.style.opacity = aberto.get() ? '0.5' : '1'
    })

    montados.set(s.id, api)
    return api
  }

  function sidebar(opcoes) {
    opcoes = opcoes || {}
    var lado = opcoes.lado === 'esquerda' ? 'left' : 'right'
    return montarPainel(opcoes, function (container, cartao) {
      container.style.top = '0'
      container.style.bottom = '0'
      container.style[lado] = '0'
      container.style.padding = '12px'
      cartao.style.width = (opcoes.largura || 340) + 'px'
      cartao.style.maxWidth = '90vw'
      cartao.style.height = '100%'
    })
  }

  function painel(opcoes) {
    opcoes = opcoes || {}
    return montarPainel(opcoes, function (container, cartao) {
      container.style.top = (opcoes.topo || 20) + 'px'
      container.style.right = (opcoes.direita || 20) + 'px'
      cartao.style.width = (opcoes.largura || 320) + 'px'
      cartao.style.maxHeight = (opcoes.altura || 420) + 'px'
    })
  }

  // ------------------------------------------------- integração com o resto

  /**
   * Espera um valor exposto pelo "Expor global" aparecer. O userscript costuma
   * rodar antes do bundle do site executar, então esperar é o caso normal.
   */
  function pegarGlobal(nome, opcoes) {
    opcoes = opcoes || {}
    var limite = opcoes.timeout || 10000
    var intervalo = 50
    return new Promise(function (resolve, reject) {
      var gasto = 0
      var tentar = function () {
        var v = globalThis[nome]
        if (v !== undefined) return resolve(v)
        gasto += intervalo
        if (gasto >= limite) {
          return reject(new Error('globalThis.' + nome + ' não apareceu em ' + limite + 'ms'))
        }
        setTimeout(tentar, intervalo)
      }
      tentar()
    })
  }

  /**
   * Estado replicado entre abas, inclusive de domínios diferentes: o valor
   * trafega pelo bus (IPC do Electron), não pela web. Ao criar, pergunta se
   * alguma outra aba já tem o valor.
   */
  var compartilhados = new Map()

  function compartilhado(chave, inicial) {
    if (compartilhados.has(chave)) return compartilhados.get(chave)

    var sinal = criarSinal(inicial)
    var topicoValor = '__jwww:shared:' + chave
    var topicoPedido = '__jwww:shared-req:' + chave
    var aplicandoDeFora = false

    bus.on(topicoValor, function (msg) {
      aplicandoDeFora = true
      try {
        sinal.set(msg.data)
      } finally {
        aplicandoDeFora = false
      }
    })

    // Aba que acabou de abrir pergunta; quem já tem o valor responde.
    bus.on(topicoPedido, function () {
      var atual = sinal.get()
      if (atual !== undefined) bus.emit(topicoValor, atual)
    })

    var api = {
      get: sinal.get,
      set: function (valor) {
        sinal.set(valor)
        if (!aplicandoDeFora) bus.emit(topicoValor, valor)
      },
      mude: function (fn) {
        api.set(fn(sinal.get()))
      },
      assinar: sinal.assinar
    }

    bus.emit(topicoPedido, null)
    compartilhados.set(chave, api)
    return api
  }

  /**
   * Chamada de função entre abas. Uma aba atende, qualquer outra chama — mesmo
   * de outro domínio. É o que permite operar o site A a partir do site B,
   * usando as funções internas dele que você expôs.
   */
  var atendentes = new Map()
  var pendentes = new Map()
  var proximoIdRpc = 0

  function registrarCanaisRpc() {
    bus.on('__jwww:rpc:req', function (msg) {
      var pedido = msg.data || {}
      var atendente = atendentes.get(pedido.metodo)
      if (!atendente) return
      Promise.resolve()
        .then(function () {
          return atendente.apply(null, pedido.args || [])
        })
        .then(
          function (valor) {
            bus.emit('__jwww:rpc:res', { id: pedido.id, ok: true, valor: valor })
          },
          function (erro) {
            bus.emit('__jwww:rpc:res', {
              id: pedido.id,
              ok: false,
              erro: String((erro && erro.message) || erro)
            })
          }
        )
    })

    bus.on('__jwww:rpc:res', function (msg) {
      var resposta = msg.data || {}
      var pendente = pendentes.get(resposta.id)
      if (!pendente) return
      pendentes.delete(resposta.id)
      clearTimeout(pendente.timer)
      if (resposta.ok) pendente.resolve(resposta.valor)
      else pendente.reject(new Error(resposta.erro || 'erro na outra aba'))
    })
  }

  var rpc = {
    atender: function (metodo, fn) {
      atendentes.set(metodo, fn)
      return function () {
        atendentes.delete(metodo)
      }
    },
    chamar: function (metodo) {
      var args = Array.prototype.slice.call(arguments, 1)
      var id = location.href + ':' + proximoIdRpc++
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          pendentes.delete(id)
          reject(new Error('ninguém atendeu "' + metodo + '" em 5s'))
        }, 5000)
        pendentes.set(id, { resolve: resolve, reject: reject, timer: timer })
        bus.emit('__jwww:rpc:req', { id: id, metodo: metodo, args: args })
      })
    }
  }

  // ------------------------------------------------------------------ saída

  /** Bus com despacho por tópico, montado sobre o transporte da ponte. */
  var ouvintesPorTopico = new Map()
  var bus = {
    emit: function (topico, dados) {
      globalThis.__jwwwBridge.emitBus(topico, dados)
    },
    /** `on('*', cb)` recebe tudo. Devolve a função de cancelar. */
    on: function (topico, cb) {
      if (typeof topico !== 'string' || typeof cb !== 'function') {
        throw new Error('jwww.bus.on(topico, cb)')
      }
      var conjunto = ouvintesPorTopico.get(topico)
      if (!conjunto) {
        conjunto = new Set()
        ouvintesPorTopico.set(topico, conjunto)
      }
      conjunto.add(cb)
      return function () {
        conjunto.delete(cb)
      }
    }
  }

  function instalar() {
    if (globalThis.jwww) return
    var ponte = globalThis.__jwwwBridge

    ponte.onBus(function (msg) {
      ;[msg.topic, '*'].forEach(function (topico) {
        var conjunto = ouvintesPorTopico.get(topico)
        if (!conjunto) return
        Array.from(conjunto).forEach(function (cb) {
          try {
            cb(msg)
          } catch (e) {
            console.error('[jwww.bus] ouvinte falhou:', e)
          }
        })
      })
    })

    var api = {
      version: ponte.version,
      bus: bus,
      ui: {
        sidebar: sidebar,
        painel: painel,
        html: html,
        cru: cru,
        estado: estado,
        efeito: efeito,
        /** remove tudo que este toolkit montou na página */
        limpar: function () {
          Array.from(montados.values()).forEach(function (p) {
            p.destruir()
          })
        }
      },
      globals: { get: pegarGlobal },
      compartilhado: compartilhado,
      rpc: rpc
    }

    globalThis.jwww = api
    registrarCanaisRpc()
  }

  /**
   * Este arquivo é injetado no início do documento, e a ponte do preload pode
   * ainda não existir nesse instante. Por isso esperamos em vez de desistir —
   * os userscripts rodam bem depois e já encontram tudo pronto.
   */
  if (globalThis.__jwwwBridge) {
    instalar()
  } else {
    var tentativas = 0
    var aguardar = setInterval(function () {
      if (globalThis.__jwwwBridge) {
        clearInterval(aguardar)
        instalar()
      } else if (++tentativas > 400) {
        clearInterval(aguardar)
      }
    }, 10)
  }
})()
