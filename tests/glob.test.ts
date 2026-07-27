import { globMatch, looseMatch, overrideMatches, suggestPattern } from '../src/shared/glob'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}

console.log('\n1. glob casa a URL inteira')
{
  const p = 'https://ex.com/assets/app.*.js'
  check('casa hash diferente', globMatch(p, 'https://ex.com/assets/app.a3f9b1.js'))
  check('casa outro hash', globMatch(p, 'https://ex.com/assets/app.ffffff.js'))
  check('não casa outro arquivo', !globMatch(p, 'https://ex.com/assets/vendor.a3f9b1.js'))
  check('não casa outro host', !globMatch(p, 'https://mal.com/assets/app.a3f9b1.js'))
  check('não casa sufixo extra', !globMatch(p, 'https://ex.com/assets/app.a3f9b1.js.map'))
  check('ancorado no início', !globMatch(p, 'https://evil.com/?u=https://ex.com/assets/app.x.js'))
}

console.log('\n2. metacaracteres de regex são literais')
{
  check('ponto não vira coringa', !globMatch('https://ex.com/a.js', 'https://ex.com/axjs'))
  check('parênteses não quebram', globMatch('https://ex.com/f(1).js', 'https://ex.com/f(1).js'))
  check('sinal de + literal', globMatch('https://ex.com/a+b.js', 'https://ex.com/a+b.js'))
}

console.log('\n3. overrideMatches: exato vs padrão')
{
  const exato = { url: 'https://ex.com/app.js' }
  check('URL exata casa', overrideMatches(exato, 'https://ex.com/app.js'))
  check('URL exata não casa parecida', !overrideMatches(exato, 'https://ex.com/app.js?v=1'))
  const glob = { url: 'https://ex.com/app.a1b2c3.js', pattern: 'https://ex.com/app.*.js' }
  check('padrão casa outro build', overrideMatches(glob, 'https://ex.com/app.999999.js'))
  check('padrão ignora a url de origem se não casar', !overrideMatches(glob, 'https://ex.com/outro.js'))
}

console.log('\n4. sugestão de padrão para bundles com hash')
{
  check(
    'hash hex após ponto',
    suggestPattern('https://ex.com/assets/app.a3f9b1.js') === 'https://ex.com/assets/app.*.js',
    suggestPattern('https://ex.com/assets/app.a3f9b1.js')
  )
  check(
    'hash após hífen',
    suggestPattern('https://ex.com/js/main-8f3ac91b.js') === 'https://ex.com/js/main-*.js',
    suggestPattern('https://ex.com/js/main-8f3ac91b.js')
  )
  check(
    'query string vira coringa',
    suggestPattern('https://ex.com/app.js?v=123') === 'https://ex.com/app.js*',
    suggestPattern('https://ex.com/app.js?v=123')
  )
  check('nome sem hash não sugere nada', suggestPattern('https://ex.com/assets/app.js') === null)
  check('palavra comum não é confundida com hash', suggestPattern('https://ex.com/bundle.min.js') === null)
  check('url inválida devolve null', suggestPattern('nao-e-url') === null)
}

console.log('\n5. sugestão gerada realmente casa a origem')
{
  for (const url of [
    'https://ex.com/assets/app.a3f9b1.js',
    'https://ex.com/js/main-8f3ac91b.js',
    'https://ex.com/app.js?v=123'
  ]) {
    const p = suggestPattern(url)
    check(`padrão de ${url} casa a própria URL`, p !== null && globMatch(p, url), p)
  }
}

console.log('\n6. looseMatch das regras de rede')
{
  check('substring sem coringa', looseMatch('analytics', 'https://x.com/analytics/collect'))
  check('glob com coringa', looseMatch('*doubleclick*', 'https://ad.doubleclick.net/x'))
  check('substring não casa ausente', !looseMatch('analytics', 'https://x.com/app.js'))
}

console.log(failures === 0 ? '\n✅ todos os testes passaram\n' : `\n❌ ${failures} falha(s)\n`)
process.exit(failures === 0 ? 0 : 1)
