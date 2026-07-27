import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

/** Persistência simples: um JSON por coleção em userData/jwww-data, validado com zod. */
export class ListStore<T extends { id: string }> {
  private items: T[] = []
  private file: string

  constructor(name: string, private schema: z.ZodType<T, z.ZodTypeDef, unknown>) {
    const dir = join(app.getPath('userData'), 'jwww-data')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, `${name}.json`)
    this.load()
  }

  private load() {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      this.items = z.array(this.schema).parse(raw)
    } catch (err) {
      console.error(`[store] arquivo inválido, movendo para .bak: ${this.file}`, err)
      try {
        renameSync(this.file, this.file + '.bak')
      } catch {}
      this.items = []
    }
  }

  private persist() {
    try {
      writeFileSync(this.file, JSON.stringify(this.items, null, 2))
    } catch (err) {
      console.error(`[store] falha ao gravar ${this.file}`, err)
    }
  }

  all(): T[] {
    return this.items
  }

  upsert(item: T) {
    const parsed = this.schema.parse(item)
    const i = this.items.findIndex((x) => x.id === parsed.id)
    if (i === -1) this.items.push(parsed)
    else this.items[i] = parsed
    this.persist()
  }

  remove(id: string) {
    this.items = this.items.filter((x) => x.id !== id)
    this.persist()
  }

  /** Troca todo o conteúdo — usado ao restaurar uma sessão salva. */
  replaceAll(items: T[]) {
    this.items = items.map((i) => this.schema.parse(i))
    this.persist()
  }
}
