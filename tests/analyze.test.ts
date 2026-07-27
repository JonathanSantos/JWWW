import {
  declaredNames,
  describeForHumans,
  describeRange,
  isExpressionSnippet,
  listFunctions,
  parses
} from '../src/shared/analyze'
import { applyWatch } from '../src/main/watch'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}

const ARQUIVO = `(function(){
  var cfg = { api: "https://x/v1", token: "abc" };
  function soma(a, b) { return a + b }
  const dobro = (n) => n * 2;
  async function busca(url, opts) { return fetch(url, opts) }
  window.total = soma(1, 2) + dobro(3);
})();`

const at = (trecho: string) => {
  const i = ARQUIVO.indexOf(trecho)
  if (i === -1) throw new Error('trecho não encontrado: ' + trecho)
  return [i, i + trecho.length] as const
}

console.log('\n1. descreve a estrutura da seleção')
{
  const info = describeRange(ARQUIVO, ...at('function soma(a, b) { return a + b }'))
  check('reconhece declaração de função', info?.kind === 'function', info?.kind)
  check('pega o nome', info?.name === 'soma', info?.name)
  check('pega os parâmetros', JSON.stringify(info?.params) === '["a","b"]', info?.params)
  check('sabe que é reatribuível', info?.reassignable === true)
  check('rótulo humano', describeForHumans(info!) === 'função soma(a, b)', describeForHumans(info!))
}

console.log('\n2. arrow ligada a const')
{
  const info = describeRange(ARQUIVO, ...at('(n) => n * 2'))
  check('reconhece arrow como função', info?.kind === 'function', info?.kind)
  check('herda o nome do const', info?.name === 'dobro', info?.name)
  check('não é reatribuível (é const)', info?.reassignable === false)
}

console.log('\n3. async')
{
  const info = describeRange(ARQUIVO, ...at('async function busca(url, opts) { return fetch(url, opts) }'))
  check('marca async', info?.isAsync === true)
  check('rótulo diz async', describeForHumans(info!).startsWith('função async'), describeForHumans(info!))
}

console.log('\n4. objeto literal no contexto do arquivo')
{
  const info = describeRange(ARQUIVO, ...at('{ api: "https://x/v1", token: "abc" }'))
  check('classifica como expressão', info?.kind === 'expression', info?.nodeType)
  check('herda o nome da variável', info?.name === 'cfg', info?.name)
}

console.log('\n5. seleção solta (sem nó correspondente) sobe para a função')
{
  // seleção desleixada, atravessando fronteiras de nós
  const info = describeRange(ARQUIVO, ...at('a, b) { return a + b'))
  check('sobe até a função que contém', info?.name === 'soma', JSON.stringify(info))

  // já uma seleção que casa exatamente com um nó é respeitada como está
  const exata = describeRange(ARQUIVO, ...at('return a + b'))
  check('nó exato não é trocado pela função', exata?.nodeType === 'ReturnStatement', exata?.nodeType)
  check('e é classificado como não instrumentável', exata?.kind === 'other', exata?.kind)
}

console.log('\n6. listFunctions')
{
  const fns = listFunctions(ARQUIVO)
  const nomes = fns.map((f) => f.name)
  check('encontra as funções nomeadas', ['soma', 'dobro', 'busca'].every((n) => nomes.includes(n)), nomes)
  check('inclui a IIFE anônima', fns.some((f) => f.name === null), nomes)
}

console.log('\n7. instrumentação de função declarada')
{
  const [start, end] = at('function soma(a, b) { return a + b }')
  const r = applyWatch(ARQUIVO, {
    label: 'soma',
    selection: ARQUIVO.slice(start, end),
    prefix: ARQUIVO.slice(Math.max(0, start - 80), start),
    suffix: ARQUIVO.slice(end, end + 80),
    stack: false
  })
  check('aplicou', r.status === 'applied', r.message)
  check('embrulha reatribuindo o binding', r.text.includes('soma = globalThis.__jwwwWatch("soma", soma)'), r.text.slice(0, 200))
  check('resultado continua parseando', parses(r.text))
  check(
    'só insere — não reescreve o arquivo',
    r.text.replace(/\n;try \{ soma = globalThis\.__jwwwWatch\("soma", soma\); \} catch \(e\) \{\}\n/, '') === ARQUIVO,
    JSON.stringify(r.text.slice(0, 160))
  )
}

console.log('\n8. instrumentação de arrow em posição de expressão')
{
  const [start, end] = at('(n) => n * 2')
  const r = applyWatch(ARQUIVO, {
    label: 'dobro',
    selection: ARQUIVO.slice(start, end),
    prefix: ARQUIVO.slice(Math.max(0, start - 80), start),
    suffix: ARQUIVO.slice(end, end + 80),
    stack: false
  })
  check('aplicou', r.status === 'applied', r.message)
  check('troca no lugar', r.text.includes('globalThis.__jwwwWatch("dobro", (n) => n * 2)'), r.text.slice(0, 240))
  check('continua parseando', parses(r.text))
}

console.log('\n9. instrumentação de expressão comum')
{
  const [start, end] = at('soma(1, 2) + dobro(3)')
  const r = applyWatch(ARQUIVO, {
    label: 'total',
    selection: ARQUIVO.slice(start, end),
    prefix: ARQUIVO.slice(Math.max(0, start - 80), start),
    suffix: ARQUIVO.slice(end, end + 80),
    stack: false
  })
  check('aplicou', r.status === 'applied', r.message)
  check('usa o modo valor', r.text.includes('__jwwwWatch.value("total"'), r.text.slice(0, 240))
  check('continua parseando', parses(r.text))
}

console.log('\n10. falhas seguras')
{
  const r = applyWatch(ARQUIVO, {
    label: 'sumiu',
    selection: 'function inexistente() {}',
    prefix: '',
    suffix: '',
    stack: false
  })
  check('âncora ausente falha sem tocar no arquivo', r.status === 'failed' && r.text === ARQUIVO, r.message)

  const [start, end] = at('var cfg = { api: "https://x/v1", token: "abc" };')
  const decl = applyWatch(ARQUIVO, {
    label: 'declaracao',
    selection: ARQUIVO.slice(start, end),
    prefix: ARQUIVO.slice(Math.max(0, start - 80), start),
    suffix: ARQUIVO.slice(end, end + 80),
    stack: false
  })
  check(
    'declaração inteira é recusada, servindo o original',
    decl.status === 'failed' && decl.text === ARQUIVO,
    decl.message
  )
}

console.log('\n11. stack opcional entra na instrumentação')
{
  const [start, end] = at('function soma(a, b) { return a + b }')
  const r = applyWatch(ARQUIVO, {
    label: 'soma',
    selection: ARQUIVO.slice(start, end),
    prefix: ARQUIVO.slice(Math.max(0, start - 80), start),
    suffix: ARQUIVO.slice(end, end + 80),
    stack: true
  })
  check('passa a opção de stack', r.text.includes('{ stack: true }'), r.text.slice(0, 220))
}

console.log('\n12. utilitários de trecho isolado')
{
  check('objeto isolado é expressão', isExpressionSnippet('{ a: 1 }'))
  check('declaração não é expressão', !isExpressionSnippet('const a = 1'))
  check('nomes declarados', JSON.stringify(declaredNames('const a = 1, b = 2')) === '["a","b"]')
  check('função declarada tem nome', JSON.stringify(declaredNames('function f(){}')) === '["f"]')
}

console.log(failures === 0 ? '\n✅ todos os testes passaram\n' : `\n❌ ${failures} falha(s)\n`)
process.exit(failures === 0 ? 0 : 1)
