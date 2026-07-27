import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

type Fixture = { body: string; type: string }

/**
 * Site de teste em memória. Os arquivos são mutáveis para os testes simularem
 * um deploy (trocar conteúdo, renomear bundle) sem mexer em disco.
 */
export class FixtureSite {
  private files = new Map<string, Fixture>()
  private server: Server | null = null
  private port = 0

  set(path: string, body: string, type = 'text/html; charset=utf-8'): this {
    this.files.set(path, { body, type })
    return this
  }

  js(path: string, body: string): this {
    return this.set(path, body, 'application/javascript')
  }

  rename(from: string, to: string): this {
    const f = this.files.get(from)
    if (!f) throw new Error(`fixture inexistente: ${from}`)
    this.files.delete(from)
    this.files.set(to, f)
    return this
  }

  /** hash SRI do conteúdo atual, para montar tags <script integrity>. */
  sri(path: string): string {
    const f = this.files.get(path)
    if (!f) throw new Error(`fixture inexistente: ${path}`)
    return 'sha384-' + createHash('sha384').update(f.body, 'utf8').digest('base64')
  }

  bodyOf(path: string): string {
    const f = this.files.get(path)
    if (!f) throw new Error(`fixture inexistente: ${path}`)
    return f.body
  }

  url(path = '/'): string {
    if (!this.port) throw new Error('servidor não iniciado')
    return `http://localhost:${this.port}${path}`
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      const file = this.files.get(path)
      if (!file) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': file.type,
        // Sem isso o Electron pode reaproveitar corpo antigo entre navegações
        // e o teste de "deploy" viraria falso-positivo.
        'cache-control': 'no-store'
      })
      res.end(file.body)
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.port = (this.server!.address() as AddressInfo).port
    return this
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
  }
}
