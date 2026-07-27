import { collectInstrumentable, parses } from '../src/shared/analyze'
import { applyExecutionMap } from '../src/main/mapping'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}

/**
 * Executa o arquivo instrumentado num sandbox com um __jwwwMap de mentira, para
 * conferir que a instrumentação não muda o comportamento do código.
 */
function rodar(codigo: string): { resultado: unknown; chamadas: Map<number, number> } {
  const chamadas = new Map<number, number>()
  const fake = (_arquivo: string, id: number, fn: unknown) => {
    if (typeof fn !== 'function') return fn
    function embrulho(this: unknown, ...args: unknown[]) {
      chamadas.set(id, (chamadas.get(id) ?? 0) + 1)
      if (new.target) return Reflect.construct(fn as never, args, new.target)
      return (fn as (...a: unknown[]) => unknown).apply(this, args)
    }
    try {
      Object.defineProperty(embrulho, 'name', { value: (fn as { name: string }).name, configurable: true })
      if ((fn as { prototype?: object }).prototype) {
        embrulho.prototype = (fn as { prototype: object }).prototype
      }
    } catch {}
    return embrulho
  }
  const globalThisFalso = { __jwwwMap: fake }
  const resultado = new Function('globalThis', `${codigo}\n;return typeof __resultado !== "undefined" ? __resultado : undefined`)(
    globalThisFalso
  )
  return { resultado, chamadas }
}

console.log('\n1. coleta as funções certas')
{
  const codigo = `
    function nomeada(a) { return a }
    const seta = (b) => b * 2;
    var anon = function () { return 1 };
    const obj = { metodo() { return 1 }, prop: function () { return 2 } };
    class C { metodoDaClasse() { return 3 } }
  `
  const fns = collectInstrumentable(codigo)
  const tipos = fns.map((f) => `${f.name ?? '?'}:${f.nodeType}`)
  check('pega declaração nomeada', tipos.some((t) => t.startsWith('nomeada:FunctionDeclaration')), tipos)
  check('pega arrow de const', tipos.some((t) => t.startsWith('seta:')), tipos)
  check('pega function expression', tipos.some((t) => t.startsWith('anon:')), tipos)
  check('pega propriedade com função', tipos.some((t) => t.startsWith('prop:')), tipos)
  check(
    'ignora atalho de método de objeto',
    !tipos.some((t) => t.startsWith('metodo:')),
    tipos
  )
  check(
    'ignora método de classe',
    !tipos.some((t) => t.startsWith('metodoDaClasse:')),
    tipos
  )
}

console.log('\n2. funções aninhadas são todas instrumentadas')
{
  const codigo = `
    const externa = () => { const interna = () => 1; return interna() };
    var __resultado = externa();
  `
  const r = applyExecutionMap(codigo, 'teste')
  check('aplicou', r.status === 'applied', r.message)
  check('catalogou as duas', r.catalog.length === 2, r.catalog.length)
  check('continua parseando', parses(r.text))

  const exec = rodar(r.text)
  check('resultado preservado', exec.resultado === 1, exec.resultado)
  check('as duas foram contadas', exec.chamadas.size === 2, [...exec.chamadas.entries()])
}

console.log('\n3. não altera o comportamento do código')
{
  const codigo = `
    function soma(a, b) { return a + b }
    const dobro = (n) => n * 2;
    var __resultado = soma(dobro(3), 4);
  `
  const r = applyExecutionMap(codigo, 'teste')
  const exec = rodar(r.text)
  check('cálculo idêntico ao original', exec.resultado === 10, exec.resultado)
  check('contou as duas funções', exec.chamadas.size === 2, [...exec.chamadas.entries()])
}

console.log('\n4. construtores continuam construindo')
{
  const codigo = `
    function Pessoa(nome) { this.nome = nome }
    Pessoa.prototype.saudacao = function () { return "oi " + this.nome };
    var p = new Pessoa("ana");
    var __resultado = p.saudacao() + "|" + (p instanceof Pessoa);
  `
  const r = applyExecutionMap(codigo, 'teste')
  check('aplicou', r.status === 'applied', r.message)
  const exec = rodar(r.text)
  check('new e prototype preservados', exec.resultado === 'oi ana|true', exec.resultado)
}

console.log('\n5. exceções continuam propagando')
{
  const codigo = `
    function explode() { throw new Error("boom") }
    var __resultado;
    try { explode() } catch (e) { __resultado = e.message }
  `
  const r = applyExecutionMap(codigo, 'teste')
  const exec = rodar(r.text)
  check('exceção chega a quem chamou', exec.resultado === 'boom', exec.resultado)
  check('a chamada foi contada mesmo lançando', exec.chamadas.size === 1, [...exec.chamadas.entries()])
}

console.log('\n6. recursão e hoisting')
{
  const codigo = `
    var __resultado = fatorial(4);
    function fatorial(n) { return n <= 1 ? 1 : n * fatorial(n - 1) }
  `
  const r = applyExecutionMap(codigo, 'teste')
  check(
    'declaração é reatribuída, não movida (hoisting preservado)',
    r.text.includes('fatorial=globalThis.__jwwwMap("teste"'),
    r.text.slice(0, 200)
  )
  const exec = rodar(r.text)
  // a chamada antes da reatribuição usa a original; as recursivas já contam
  check('resultado correto', exec.resultado === 24, exec.resultado)
}

console.log('\n7. o texto original é preservado entre as inserções')
{
  const codigo = `function a(){return 1}\nconst b=()=>2;`
  const r = applyExecutionMap(codigo, 'teste')
  const semInsercoes = r.text
    .replace(/\n;try\{[^}]*\}catch\(e\)\{\}\n/g, '')
    .replace(/globalThis\.__jwwwMap\("teste",\d+,/g, '')
    .replace(/\)/g, (m, i, s) => (s.slice(0, i).endsWith('=>2') ? '' : m))
  check(
    'só inserções — nada do código original foi reescrito',
    semInsercoes.includes('function a(){return 1}') && semInsercoes.includes('const b=()=>2'),
    JSON.stringify(semInsercoes)
  )
}

console.log('\n8. limites e falhas seguras')
{
  const vazio = applyExecutionMap('var a = 1;', 'teste')
  check('arquivo sem funções é recusado', vazio.status === 'failed' && vazio.text === 'var a = 1;', vazio.message)

  const muitas = Array.from({ length: 6100 }, (_, i) => `function f${i}(){return ${i}}`).join('\n')
  const acima = applyExecutionMap(muitas, 'teste')
  check('acima do limite é recusado', acima.status === 'failed', acima.message)
  check('e devolve o original intacto', acima.text === muitas)
}

console.log('\n9. catálogo aponta para o lugar certo')
{
  const codigo = `function primeira(){return 1}\n\nfunction segunda(){return 2}`
  const r = applyExecutionMap(codigo, 'teste')
  const primeira = r.catalog.find((f) => f.name === 'primeira')
  const segunda = r.catalog.find((f) => f.name === 'segunda')
  check('linha da primeira', primeira?.line === 1, primeira)
  check('linha da segunda', segunda?.line === 3, segunda)
  check(
    'offsets recortam a função original',
    codigo.slice(segunda!.start, segunda!.end) === 'function segunda(){return 2}',
    codigo.slice(segunda!.start, segunda!.end)
  )
}

console.log(failures === 0 ? '\n✅ todos os testes passaram\n' : `\n❌ ${failures} falha(s)\n`)
process.exit(failures === 0 ? 0 : 1)
