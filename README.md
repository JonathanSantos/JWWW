# JWWW — navegador para devs

Browser Electron com um console de desenvolvimento próprio: overrides resilientes de JS/CSS/HTML,
"expor seleção como global", bus de mensagens entre abas (independente de domínio), userscripts
injetados no mundo da página e controle de rede.

## Rodando

```bash
npm install
npm run dev        # dev com HMR na UI e restart do main
npm run test       # tudo: unitários + e2e
npm run test:unit  # mapeamento da formatação e casamento de glob (quebrar aqui corrompe arquivo)
npm run test:e2e   # Playwright dirigindo o app de verdade (faz build antes)
npm run typecheck  # tsc no main + renderer
npm run build      # build de produção em out/
```

Variáveis úteis: `JWWW_START_URL` define a página da primeira aba;
`JWWW_DEBUG=1` loga as mensagens do bus no terminal;
`JWWW_DEBUG_PORT=9222` abre a porta CDP da própria UI do JWWW (inspeção e automação).

> Rode **uma instância por vez** — há um lock de instância única, já que todas
> compartilhariam os mesmos JSONs de override/script.

## Stack

- **Electron + electron-vite** — abas são `WebContentsView` gerenciadas pelo main process; a UI do
  browser (barra, abas, painel dev) é React + TypeScript + Tailwind v4 + shadcn/ui.

  > A página é um view **nativo, composto por cima** da janela da UI: qualquer
  > elemento do renderer que cruze a área dela some atrás. Por isso a página é
  > escondida enquanto há diálogo aberto — o tratamento vive no componente
  > `Dialog`, para nenhum diálogo novo reintroduzir o problema.
- **CDP** (`webContents.debugger`) por aba — captura de rede (`Network.*`), interceptação e reescrita
  de respostas (`Fetch.requestPaused` → `fulfillRequest`), injeção de userscripts
  (`Page.addScriptToEvaluateOnNewDocument`), throttling, bloqueio.
- **Monaco** para edição, **zod** validando IPC e persistência, **zustand** no estado da UI,
  **diff-match-patch** + **acorn** no motor de overrides.

## Como funcionam os overrides (a parte importante)

Um override **nunca é uma cópia local do arquivo**. Guardamos o snapshot do original
(`originalText` + `originalHash`) e o texto editado. A cada reload, a resposta real do servidor é
interceptada no estágio de Response e:

1. Se o hash do corpo bate com o snapshot → serve o texto editado (status **aplicado**).
2. Se o arquivo mudou no servidor → o diff `original → editado` é reaplicado por cima do corpo novo
   com fuzzy patch (status **fuzzy**, com aviso).
3. Se o patch não aplica → **serve o original intacto** e avisa o dev (status **falhou**).

Ou seja: um override antigo não quebra uma página que mudou de estrutura.

### Expor seleção como global

No Editor, selecione um trecho de JS → "Expor global" → dê um nome. A seleção vira uma âncora
textual (com contexto antes/depois). No próximo reload o arquivo é patchado em memória:

- Trecho é **expressão** → vira `(globalThis.nome = (trecho))`, preservando semântica.
- Trecho é **declaração** (`function f`, `class C`, `const x = …`) → injeta
  `;try { globalThis.nome = f } catch {}` logo após.
- O arquivo transformado é validado com acorn; se a sintaxe quebrasse, reverte e avisa.
- Âncora não encontrada (site mudou) → serve original e avisa.

### Mapa de execução: "o que roda nesta página?"

Botão **Mapear** no editor. Todas as funções do arquivo passam a ser contadas, e
o painel **Mapa** responde a pergunta que trava qualquer um diante de um bundle
minificado de 3 MB: *o que aqui dentro realmente importa?*

O topo do painel dá o número que interessa — "127 de 1.243 funções executaram
(10%)" —, e a lista vem ranqueada com barra proporcional, para dar pra ler no
olho sem comparar números. Dá para ordenar por chamadas, por tempo ou por ordem
de execução, e marcar "incluir as que nunca rodaram" para ver o código morto.

O tempo é medido em duas formas, e a diferença importa: **próprio** desconta o
que as funções chamadas gastaram, **total** inclui. Ordenar por total sempre
levaria as funções mais externas ao topo — elas herdam o tempo de tudo que
chamam. Por próprio você acha quem realmente queima CPU. A coluna mostra o
próprio; o total aparece ao passar o mouse.

**O fluxo que vale a pena:** clique em *Zerar contadores*, interaja com o site,
e o painel mostra só o que aquela ação disparou. É como achar o código de um
botão em segundos, sem caçar handler no meio do bundle.

Com source map, os nomes minificados são resolvidos: em vez de `o` e `n`, você
lê `calcularDesconto` e `precos.ts:7`.

Detalhes de implementação que importam:

- A instrumentação é **só por inserção**, nunca substituindo intervalos. É o que
  permite instrumentar milhares de funções aninhadas de uma vez: pontos de
  inserção não se invalidam entre si, intervalos sim.
- O runtime **agrega na página** e envia em lotes de 400 ms. Uma função dentro
  de um laço geraria dezenas de milhares de mensagens por segundo.
- O embrulho preserva `new` (via `Reflect.construct`), `prototype`, `name` e as
  exceções — instrumentar não pode mudar o comportamento do site.
- Métodos de classe e atalhos de objeto (`foo() {}`) ficam de fora: o intervalo
  do nó cobre só `(){...}` e embrulhar geraria sintaxe inválida.
- Acima de 6.000 funções o JWWW recusa: o embrulho pesaria mais que o insight.

### Observar execução

Selecione uma função ou expressão no editor e use **Observar**. A cada execução,
o painel **Observar** registra argumentos, retorno, duração e — opcionalmente —
quem chamou. Funciona com `async` (espera a promise resolver) e com exceções,
que continuam sendo lançadas normalmente para a página.

Enquanto o `Expor global` responde *"qual é o valor disso"*, observar responde
*"quando isso roda e com quê"* — sem precisar recolocar um breakpoint a cada
reload.

O trecho é reconhecido por AST, então o diálogo já diz o que você selecionou
(`função async buscarNome(id)`), sugere o nome como rótulo e recusa o que não dá
para instrumentar com segurança.

### Source maps: ler o fonte original

Ao abrir um JS que publica `//# sourceMappingURL=`, aparece um seletor de
arquivo de origem na toolbar. Escolhendo um, o editor mostra o **TypeScript (ou
JSX) original** em vez do bundle minificado — com os tipos, os nomes de verdade
e os comentários que sumiram no build.

O ponto importante: **Expor global e Observar funcionam a partir do fonte**. A
seleção é traduzida pelo source map para a posição correspondente no bundle, o
AST expande até o nó inteiro, e o override é ancorado **no bundle** — que é o
arquivo que o servidor entrega. Você lê e escolhe no código que escreveu;
o JWWW instrumenta o código que roda.

Se o ponto selecionado não existe no bundle (tipos, `interface`, ramos removidos
pelo build), o JWWW avisa em vez de adivinhar. Ele não procura um ponto mapeado
nas linhas seguintes de propósito: selecionar um tipo e acabar instrumentando a
função de baixo seria pior do que dizer que ali não há correspondência.

**A visão do fonte é somente leitura, e isso é honesto.** Aplicar uma edição do
TypeScript de volta no bundle exigiria rodar o build do site — tsconfig,
plugins, minificador —, que não temos. Editar continua sendo no bundle, com o
`Formatar` para deixá-lo legível.

### AST: entender e localizar, nunca gerar

`src/shared/analyze.ts` faz o parse com acorn e devolve **offsets**. É uma regra
do projeto: nada regenera código a partir da árvore. Regenerar produziria um
arquivo com formatação diferente da original e destruiria o fuzzy patch, que é a
base de todo o resto. Sabendo que a seleção é uma `FunctionDeclaration` chamada
`soma` que começa no offset 412, a edição é textual e cirúrgica — o resto do
arquivo continua byte a byte igual ao que o servidor entregou.

Isso também melhorou o `Expor global`: antes ele classificava o trecho isolado
(onde `{a: 1}` parece um bloco); agora usa a árvore do arquivo inteiro, que sabe
o que o trecho é no contexto dele.

### Toolkit de UI: um framework dentro do navegador

`jwww.ui` está disponível em toda página. Monta painel em **shadow DOM**, então o
CSS do site não vaza para dentro nem o seu vaza para fora. Um painel lateral com
botão flutuante é uma linha:

```js
const p = jwww.ui.sidebar({ id: 'meu', titulo: 'Meu painel', botao: '🛠' })
const n = jwww.ui.estado(0)

p.render(({ html }) => html`
  <p>Cliques: ${n.get()}</p>
  <button onclick=${() => n.mude((v) => v + 1)}>Somar</button>
`)
```

`render` re-executa sozinho quando um estado lido dentro dele muda — o
rastreamento de dependência é automático. `html` escapa interpolação por padrão
(dado do site não vira HTML), e função em atributo de evento vira listener de
verdade, sem `eval`. O painel guarda aberto/fechado por site.

Também tem `jwww.ui.painel()` (cartão flutuante) e `jwww.ui.limpar()`.

### O que só dá para fazer aqui

O toolkit existe para compor com o resto do JWWW:

```js
// 1) valor arrancado do bundle do site com "Expor global"
const carrinho = await jwww.globals.get('carrinho')

// 2) replicado para todas as abas, inclusive de outros domínios
const compartilhado = jwww.compartilhado('carrinho', carrinho)

// 3) e o site B pode chamar uma função interna do site A
jwww.rpc.atender('limparCarrinho', () => carrinho.limpar())
// da outra aba:  await jwww.rpc.chamar('limparCarrinho')
```

`jwww.globals.get` espera o valor aparecer — o userscript costuma rodar antes do
bundle do site executar. `jwww.compartilhado` sincroniza pelo IPC do Electron,
não pela web, então não há CORS nem same-origin no caminho: uma aba do site A e
outra do site B veem o mesmo valor.

O RPC é **broadcast, e quem responder primeiro ganha** — se duas abas atendem o
mesmo método, você recebe a resposta mais rápida. Restrinja pelo padrão de URL
do userscript quando isso importar.

O painel **Scripts** traz modelos prontos para os quatro fluxos acima.

### Bus entre abas

Toda página recebe `window.jwww.bus` via preload (contextBridge):

```js
jwww.bus.emit('meu-topico', { qualquer: 'coisa' })
jwww.bus.on('meu-topico', (msg) => console.log(msg.data, msg.from))
jwww.bus.on('*', (msg) => {}) // tudo
```

As mensagens trafegam por IPC do Electron — nunca pela web — então atravessam abas e domínios sem
same-origin/CORS. O painel **Bus** mostra o tráfego ao vivo e permite publicar manualmente.

### Userscripts

Painel **Scripts**: código JS + padrões de URL (`https://*.exemplo.com/*`) + `document-start|end`.
Injetados via CDP **no mundo da página** — rodam com a origem do site, então chamadas a APIs internas
do site passam pelas proteções de same-origin como se fossem do próprio site. Combine com o bus para
estender sites com UI própria e comunicação entre abas.

### Formatação que não estraga o override

Botão **Formatar** no editor (JS, CSS, HTML, JSON). O detalhe que importa: o
beautify só mexe em espaço em branco, então construímos um mapa de posições
entre o arquivo original e o formatado. Suas edições são feitas no texto bonito
e **remapeadas de volta para o arquivo original** antes de virar override.

Consequência prática: o que vai para o navegador continua sendo o arquivo do
servidor com a sua mudança pontual — nunca o arquivo inteiro reformatado. Isso
preserva o fuzzy patch quando o site mudar. A seleção do **Expor global** também
é remapeada, então a âncora casa com o arquivo minificado real.

Se o mapeamento não for confiável para algum arquivo, a formatação vira somente
leitura em vez de gerar um override que não daria para reaplicar.
`npm test` cobre esse mapeamento.

### Overrides por padrão (glob)

Um override casa por URL exata por padrão. Bundles modernos trazem o hash do
conteúdo no nome (`app.a3f9b1.js`), então esse override morre no próximo deploy.
Ao salvar, o JWWW detecta o hash e oferece o glob equivalente
(`…/app.*.js`) num clique; dá para editar o padrão a qualquer momento pelo
painel **Overrides** (ícone de regex), que também mostra se ele casa com a URL
de origem.

`*` casa qualquer sequência e o padrão precisa casar a URL inteira — não é
substring, justamente para um glob descuidado não pegar arquivo de outro host.

### Diff

Botão **Diff** no editor, renderizado inline (o painel dev é estreito demais
para duas colunas de código), com dois modos:

- **original × suas mudanças** — o que você alterou sobre o arquivo do servidor.
- **original × servidor agora** — o que o *site* mudou desde que você criou o
  override. É a resposta para "apliquei com fuzzy, mas o que mudou afinal?".

Bundles minificados são formatados automaticamente no diff (é só leitura, então
não afeta nada do que é servido).

### SRI (integrity) e CSP

Scripts com `integrity=` seriam bloqueados ao serem modificados. O JWWW remove o
atributo **apenas das tags cujo recurso tem override ativo** — o resto da página
continua protegido pelo SRI — e avisa no painel quando faz isso.

O botão de escudo no painel **Rede** desabilita CSP na sessão (headers e
`<meta>`), útil para injetar UI em sites restritivos. É opt-in e volta ao normal
ao reiniciar o app, de propósito.

### Sessões

Painel **Sessões**: um retrato nomeado de tudo que você configurou — overrides,
scripts e regras de rede — guardado localmente e exportável para um `.json`
que dá para versionar no git ou passar para outra pessoa. Restaurar substitui
o estado atual (com confirmação); importar sempre cria uma entrada nova, então
importar duas vezes não sobrescreve nada.

### Rede

Painel **Rede**: log completo por aba, bloqueio por padrão (`*analytics*` ou substring), throttling
(Fast/Slow 3G, offline), tamanhos e tempos. Cache HTTP e service workers são bypassados enquanto o
console está ativo (como o "Disable cache" do DevTools) para a interceptação ser confiável.

## Testes

`npm run test:e2e` sobe o app empacotado com o Playwright (`_electron`) e exercita
os fluxos de verdade: abrir arquivo pela árvore, formatar, editar, salvar, expor
global, diff, sessões. As páginas de teste vêm de um servidor HTTP em memória
(`tests/e2e/helpers/server.ts`) cujos arquivos são mutáveis, o que permite
simular um deploy no meio do teste.

Cada teste roda com `userData` próprio num diretório temporário. Isso mantém os
seus overrides reais intocados e, de quebra, faz o lock de instância única (que
é por `userData`) não brigar com um JWWW aberto na máquina.

## O que já foi verificado rodando

- Override de HTML aplicado sobre o corpo do servidor, com acentos e emoji corretos
  (o `charset=utf-8` é reinjetado no `content-type` ao reescrever).
- Override aplicado já no **primeiro** load da aba, não só após reload — o attach do CDP
  acontece antes da navegação real.
- `expose`: um `const` preso dentro de uma **IIFE** virou `globalThis.cfg` acessível no console.
- Resiliência: depois de um "deploy" que renomeou o trecho ancorado, o expose falhou,
  o arquivo **original** foi servido e a página continuou funcionando normalmente.
- Bus: userscript rodando no mundo da página emitiu e recebeu mensagens entre origens.
- SRI: override aplicado num `<script integrity=…>` real — sem o strip o browser
  bloquearia o script e a página ficaria em branco.
- Formatação: arquivo minificado formatado no editor, editado ali, salvo — e o
  override gravado em disco continua em uma linha só, com apenas a mudança do dev.
- Árvore de recursos com pastas aninhadas e colapso de pasta única (`js/vendor`).
- Observar: função instrumentada registra cada chamada com argumentos e retorno,
  sem alterar o valor que chega a quem chamou nem engolir exceções.
- Source map: com um bundle real gerado pelo esbuild, selecionar a função no
  TypeScript criou um override ancorado no **bundle** (não no fonte) e a
  instrumentação funcionou em runtime.
- Mapa de execução: zerar os contadores e clicar num botão do site mostrou só as
  funções daquela interação, com a contagem certa do laço; e o código morto
  ficou de fora. O valor calculado pela página continuou o mesmo.
- Toolkit: painel sobreviveu a um `display:none` que o site declarava para a
  mesma classe, e nada dele vazou para fora do shadow root. HTML vindo do site
  virou texto, não elemento. Estado escrito numa aba apareceu em outra, de outra
  origem; e o RPC devolveu o título de uma aba para a outra.
- Glob: override criado em `app.a3f9b1.js` continuou valendo em `app.ff0099.js`
  depois de um "deploy" que trocou nome **e** conteúdo do bundle.
- Diff nos dois modos, com o modo servidor buscando o corpo real do site
  (sem override aplicado).
- Sessão salva, overrides apagados, sessão restaurada — glob e conteúdo editado
  preservados.

## Limitações conhecidas (roadmap)

- Editar o fonte original e regerar o bundle não é possível (exigiria o build do
  site). O fonte é leitura; a edição continua no bundle.
- Sem edição de headers/redirect por regra (só block); sem replay de request.
- `Expor global` só para arquivos JS externos (não inline em HTML).
- Streaming (SSE/WebSocket) não é interceptado no estágio de Response (por design).

## Estrutura

```
src/
  main/        # processo main: tabs (WebContentsView), cdp, overrides, ipc, stores
  preload/     # ui.ts (window.api da UI) e page.ts (window.jwww das páginas)
  renderer/    # React: chrome do browser + painéis do console dev
  shared/      # tipos e schemas zod compartilhados
```
