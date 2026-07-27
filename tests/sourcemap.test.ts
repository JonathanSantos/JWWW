import {
  decodeDataUrl,
  findSourceMappingURL,
  offsetToPosition,
  positionToOffset,
  resolveSourceMapURL,
  resolveSourceURL,
  sourceLabel
} from '../src/shared/sourcemap'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}

console.log('\n1. descoberta do comentário')
{
  check(
    'comentário de linha no fim',
    findSourceMappingURL('var a=1;\n//# sourceMappingURL=app.js.map') === 'app.js.map'
  )
  check(
    'comentário de bloco',
    findSourceMappingURL('var a=1;\n/*# sourceMappingURL=app.js.map */') === 'app.js.map'
  )
  check('variante com @', findSourceMappingURL('var a=1;\n//@ sourceMappingURL=x.map') === 'x.map')
  check('linha em branco depois não atrapalha', findSourceMappingURL('a\n//# sourceMappingURL=y.map\n\n') === 'y.map')
  check('sem comentário devolve null', findSourceMappingURL('var a=1;') === null)
}

console.log('\n2. não confunde texto dentro do código')
{
  // a string aparece no meio do arquivo, não como comentário final
  const corpo = 'var s = "//# sourceMappingURL=falso.map";\nvar a = 1;'
  check('ocorrência dentro de string é ignorada', findSourceMappingURL(corpo) === null, findSourceMappingURL(corpo))
}

console.log('\n3. resolução de URL')
{
  check(
    'relativa ao recurso',
    resolveSourceMapURL('app.js.map', 'https://ex.com/assets/app.js') === 'https://ex.com/assets/app.js.map'
  )
  check(
    'caminho absoluto',
    resolveSourceMapURL('/maps/app.map', 'https://ex.com/assets/app.js') === 'https://ex.com/maps/app.map'
  )
  check('data URI passa direto', resolveSourceMapURL('data:application/json;base64,e30=', 'https://ex.com/a.js') === 'data:application/json;base64,e30=')
}

console.log('\n4. data URI')
{
  const json = '{"version":3,"sources":["a.ts"],"mappings":""}'
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  check('base64', decodeDataUrl(`data:application/json;base64,${b64}`) === json)
  check('percent-encoded', decodeDataUrl(`data:application/json,${encodeURIComponent(json)}`) === json)
  check('lixo devolve null', decodeDataUrl('data:application/json;base64,!!!') === null)
}

console.log('\n5. resolução dos fontes')
{
  const map = { version: 3, sources: ['src/app.ts'], mappings: '', sourceRoot: '/raiz/' }
  check(
    'usa sourceRoot',
    resolveSourceURL('src/app.ts', map as never, 'https://ex.com/a.js.map') === 'https://ex.com/raiz/src/app.ts',
    resolveSourceURL('src/app.ts', map as never, 'https://ex.com/a.js.map')
  )
  const semRoot = { version: 3, sources: ['../src/app.ts'], mappings: '' }
  check(
    'relativo ao mapa',
    resolveSourceURL('../src/app.ts', semRoot as never, 'https://ex.com/dist/a.js.map') ===
      'https://ex.com/src/app.ts'
  )
}

console.log('\n6. rótulos')
{
  check('encurta caminho', sourceLabel('webpack:///./src/app/index.ts') === 'app/index.ts', sourceLabel('webpack:///./src/app/index.ts'))
  check('nome curto passa', sourceLabel('app.ts') === 'app.ts')
  check('nulo', sourceLabel(null) === '(sem nome)')
}

console.log('\n7. offset <-> linha/coluna')
{
  const texto = 'linha1\nlinha2\nlinha3'
  check('início', JSON.stringify(offsetToPosition(texto, 0)) === '{"line":1,"column":0}')
  check(
    'começo da segunda linha',
    JSON.stringify(offsetToPosition(texto, 7)) === '{"line":2,"column":0}',
    JSON.stringify(offsetToPosition(texto, 7))
  )
  check(
    'meio da terceira',
    JSON.stringify(offsetToPosition(texto, 16)) === '{"line":3,"column":2}',
    JSON.stringify(offsetToPosition(texto, 16))
  )
  check('ida e volta', positionToOffset(texto, 3, 2) === 16)
  check('coluna além do fim satura', positionToOffset(texto, 3, 999) === texto.length)
  check('linha além do fim satura', positionToOffset(texto, 99, 0) === texto.length)

  // propriedade: converter e voltar tem que dar no mesmo lugar
  let idas = 0
  for (let i = 0; i <= texto.length; i++) {
    const p = offsetToPosition(texto, i)
    if (positionToOffset(texto, p.line, p.column) === i) idas++
  }
  check('ida e volta em todos os offsets', idas === texto.length + 1, `${idas}/${texto.length + 1}`)
}

console.log(failures === 0 ? '\n✅ todos os testes passaram\n' : `\n❌ ${failures} falha(s)\n`)
process.exit(failures === 0 ? 0 : 1)
