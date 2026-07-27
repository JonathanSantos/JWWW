/**
 * Assinatura ad-hoc no macOS quando não há certificado configurado.
 *
 * Empacotar renomeia o binário e troca o conteúdo do bundle, o que invalida a
 * assinatura que veio do Electron. Sem assinar de novo, `codesign --verify`
 * falha e o app quebra em máquinas Apple Silicon com política mais estrita.
 * A assinatura ad-hoc (`--sign -`) resolve isso — ela não substitui a
 * assinatura de distribuição: para publicar ainda é preciso um Developer ID e
 * notarização (ver README).
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // Havendo certificado de verdade, o electron-builder assina depois daqui.
  if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_KEY_PASSWORD) return

  // Num build universal, cada arquitetura é empacotada num diretório `-temp` e
  // só depois as duas são fundidas. Assinar os intermediários faz o
  // `_CodeSignature/CodeResources` divergir entre elas, e a fusão exige que
  // todo arquivo não binário tenha o mesmo SHA nos dois lados — a assinatura
  // tem que esperar o app já fundido, que passa por aqui de novo.
  if (/-(x64|arm64)-temp$/.test(context.appOutDir)) return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log(`  • assinatura ad-hoc aplicada  app=${app}`)
}
