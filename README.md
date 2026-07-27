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
- Glob: override criado em `app.a3f9b1.js` continuou valendo em `app.ff0099.js`
  depois de um "deploy" que trocou nome **e** conteúdo do bundle.
- Diff nos dois modos, com o modo servidor buscando o corpo real do site
  (sem override aplicado).
- Sessão salva, overrides apagados, sessão restaurada — glob e conteúdo editado
  preservados.

## Limitações conhecidas (roadmap)
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
