/**
 * Gera `build/icon.png` (1024×1024) a partir de `build/icon.svg`.
 *
 * O electron-builder converte esse PNG para .icns e .ico sozinho, então basta
 * um arquivo. Rasterizamos com o próprio Electron para não trazer uma
 * dependência de imagem só para isso — e o resultado é o mesmo motor que
 * desenha a UI.
 *
 *   npm run icon
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const LADO = 1024
const raiz = join(__dirname, '..')
const svg = readFileSync(join(raiz, 'build', 'icon.svg'), 'utf8')

const html =
  `<!doctype html><meta charset="utf-8">` +
  `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}` +
  `svg{display:block;width:${LADO}px;height:${LADO}px}</style>` +
  svg

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: LADO,
    height: LADO,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // Sem isto a captura sai antes do primeiro paint em telas Retina.
  await new Promise((r) => setTimeout(r, 300))

  const captura = await win.webContents.capturePage()
  // Em tela Retina a captura vem em 2x; normalizar deixa a saída determinística.
  const imagem =
    captura.getSize().width === LADO ? captura : captura.resize({ width: LADO, height: LADO, quality: 'best' })

  const destino = join(raiz, 'build', 'icon.png')
  writeFileSync(destino, imagem.toPNG())
  console.log(`ícone gerado: ${destino} (${imagem.getSize().width}×${imagem.getSize().height})`)
  app.exit(0)
})
