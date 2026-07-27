import {
  applyPrettyEdits,
  buildOffsetMap,
  makeAnchor,
  mapRange,
  prettify
} from '../src/renderer/src/lib/prettify'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}

const MIN = `(function(){var a={api:"https://x/v1",token:"abc"};function soma(l){return l.reduce(function(s,i){return s+i.p},0)}window.onload=function(){document.body.textContent=soma([{p:1},{p:2}])}})();`

console.log('\n1. mapeamento identidade')
{
  const pretty = prettify(MIN, 'javascript')
  const map = buildOffsetMap(MIN, pretty)
  check('map construído (só espaço em branco mudou)', map !== null)
  const anchor = makeAnchor(MIN, 'javascript')
  check('sem edição, volta idêntico ao original', applyPrettyEdits(anchor, anchor.prettyBase) === MIN)
}

console.log('\n2. edição no texto formatado volta para o minificado')
{
  const anchor = makeAnchor(MIN, 'javascript')
  const edited = anchor.prettyBase.replace('"abc"', '"TOKEN_NOVO"')
  const out = applyPrettyEdits(anchor, edited)
  check('resultado não é null', out !== null)
  check('edição presente', out!.includes('"TOKEN_NOVO"'), out?.slice(0, 120))
  check('token antigo sumiu', !out!.includes('"abc"'))
  check(
    'formatação original preservada (continua minificado)',
    !out!.includes('\n  '),
    JSON.stringify(out?.slice(0, 100))
  )
  check('resto do arquivo intacto', out! === MIN.replace('"abc"', '"TOKEN_NOVO"'), out)
}

console.log('\n3. inserção de linha nova no formatado')
{
  const anchor = makeAnchor(MIN, 'javascript')
  const edited = anchor.prettyBase.replace('function soma(', 'function novaFn(){return 42}\nfunction soma(')
  const out = applyPrettyEdits(anchor, edited)
  check('inserção aplicada', out !== null && out.includes('function novaFn(){return 42}'), out?.slice(0, 160))
  check('código original ainda presente', out !== null && out.includes('l.reduce'))
}

console.log('\n4. mapeamento de seleção (expose global)')
{
  const anchor = makeAnchor(MIN, 'javascript')
  const alvo = 'var a = {'
  const idx = anchor.prettyBase.indexOf(alvo)
  check('trecho existe no formatado', idx !== -1)
  const range = mapRange(anchor, idx, idx + alvo.length)
  check('range mapeado', range !== null)
  const originalSlice = MIN.slice(range![0], range![1])
  check(
    'seleção mapeada casa com o minificado',
    originalSlice.replace(/\s+/g, '') === alvo.replace(/\s+/g, ''),
    JSON.stringify(originalSlice)
  )
  check('trecho mapeado existe mesmo no arquivo servido', MIN.includes(originalSlice))
}

console.log('\n5. CSS')
{
  const css = `.a{color:red;margin:0}.b{padding:1px}`
  const anchor = makeAnchor(css, 'css')
  check('map css ok', anchor.map !== null)
  const edited = anchor.prettyBase.replace('red', 'blue')
  const out = applyPrettyEdits(anchor, edited)
  check('css editado corretamente', out === `.a{color:blue;margin:0}.b{padding:1px}`, out)
}

console.log('\n6. detecção de mapeamento inseguro')
{
  const map = buildOffsetMap('abc', 'axc')
  check('retorna null quando conteúdo difere', map === null)
}

console.log(failures === 0 ? '\n✅ todos os testes passaram\n' : `\n❌ ${failures} falha(s)\n`)
process.exit(failures === 0 ? 0 : 1)
