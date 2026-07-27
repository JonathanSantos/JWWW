import type { WebContents } from 'electron'
import type {
  ConsoleEntry,
  MapCatalogEvent,
  NetEntry,
  OverrideStatusEvent,
  RemoteValue,
  ThrottlePreset
} from '@shared/types'
import { findSourceMappingURL, resolveSourceMapURL } from '@shared/sourcemap'
import type { NetRule } from '@shared/schemas'
import { OverrideEngine, stripHash } from './overrides'
import { ruleMatches } from './netrules'
import { isCspHeader, stripIntegrity, stripMetaCsp } from './sri'

/**
 * Interceptação em dois estágios:
 *  - Request: todas as requisições (permite bloquear via regras de rede)
 *  - Response: Document/Stylesheet/Script/XHR/Fetch (permite reescrever o corpo
 *    com os overrides antes de chegar à página — Fetch.fulfillRequest)
 */
const INTERCEPT_PATTERNS = [
  { urlPattern: '*', requestStage: 'Request' },
  { urlPattern: '*', resourceType: 'Document', requestStage: 'Response' },
  { urlPattern: '*', resourceType: 'Stylesheet', requestStage: 'Response' },
  { urlPattern: '*', resourceType: 'Script', requestStage: 'Response' },
  { urlPattern: '*', resourceType: 'XHR', requestStage: 'Response' },
  { urlPattern: '*', resourceType: 'Fetch', requestStage: 'Response' }
]

const THROTTLE_PRESETS: Record<ThrottlePreset, object> = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  fast3g: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  slow3g: { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }
}

type Deps = {
  overrides: OverrideEngine
  getRules: () => NetRule[]
  getBundle: () => string | null
  getDisableCsp: () => boolean
  emitNet: (tabId: number, entries: NetEntry[]) => void
  emitNetClear: (tabId: number) => void
  emitOverrideStatus: (ev: OverrideStatusEvent) => void
  emitMapCatalog: (ev: MapCatalogEvent) => void
  emitConsole: (entries: ConsoleEntry[]) => void
  emitConsoleClear: (tabId: number) => void
}

const NIVEIS: Record<string, ConsoleEntry['level']> = {
  log: 'log',
  info: 'info',
  warning: 'warn',
  error: 'error',
  debug: 'debug',
  dir: 'log',
  table: 'log',
  trace: 'debug',
  assert: 'error'
}

function mapearNivel(tipo: string): ConsoleEntry['level'] {
  return NIVEIS[tipo] ?? 'log'
}

/** Converte o RemoteObject do CDP no formato que a UI entende. */
function toRemoteValue(o: any): RemoteValue {
  if (!o || typeof o !== 'object') return { type: 'undefined' }
  const preview = o.preview
    ? {
        overflow: Boolean(o.preview.overflow),
        properties: (o.preview.properties ?? []).map((p: any) => ({
          name: String(p.name),
          type: String(p.type),
          subtype: p.subtype,
          value: p.value === undefined ? undefined : String(p.value)
        }))
      }
    : undefined
  return {
    type: o.type,
    subtype: o.subtype,
    value: o.value,
    description: o.description,
    objectId: o.objectId,
    className: o.className,
    preview
  }
}

function quadro(f: any): string {
  const nome = f.functionName || '(anônima)'
  return `${nome} — ${f.url || '?'}:${(f.lineNumber ?? 0) + 1}`
}

function origemDoStack(stack: any): string | undefined {
  const f = stack?.callFrames?.[0]
  if (!f?.url) return undefined
  return `${f.url}:${(f.lineNumber ?? 0) + 1}`
}

function formatarPilha(stack: any): string | undefined {
  const quadros = stack?.callFrames
  if (!Array.isArray(quadros) || quadros.length === 0) return undefined
  return quadros.slice(0, 8).map(quadro).join('\n')
}

/** O source map do bundle é resolvido aqui porque só o main tem o corpo cru. */
function resolveMapUrl(body: string, resourceUrl: string): string | null {
  const referencia = findSourceMappingURL(body)
  return referencia ? resolveSourceMapURL(referencia, resourceUrl) : null
}

export class TabDebugger {
  private entries = new Map<string, NetEntry>()
  private order: string[] = []
  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private scriptIds: string[] = []
  private consoleFila: ConsoleEntry[] = []
  private consoleTimer: ReturnType<typeof setTimeout> | null = null
  private consoleSeq = 0
  attached = false

  constructor(
    private wc: WebContents,
    private tabId: number,
    private deps: Deps
  ) {}

  private send(method: string, params?: unknown): Promise<any> {
    return this.wc.debugger.sendCommand(method, params as any)
  }

  private sendSafe(method: string, params?: unknown): Promise<any> {
    return this.send(method, params).catch((err) => {
      console.warn(`[cdp] ${method}:`, err?.message ?? err)
    })
  }

  async attach() {
    try {
      this.wc.debugger.attach('1.3')
    } catch (err) {
      console.error('[cdp] attach falhou:', err)
      return
    }
    this.attached = true
    this.wc.debugger.on('message', (_e, method, params) => {
      this.onMessage(method, params as any)
    })
    this.wc.debugger.on('detach', (_e, reason) => {
      this.attached = false
      console.warn('[cdp] detach:', reason)
    })
    await this.sendSafe('Network.enable', {
      maxTotalBufferSize: 128 * 1024 * 1024,
      maxResourceBufferSize: 32 * 1024 * 1024
    })
    // Sem isso, respostas do cache/service worker escapariam da interceptação
    // e os overrides não aplicariam de forma confiável.
    await this.sendSafe('Network.setBypassServiceWorker', { bypass: true })
    await this.sendSafe('Network.setCacheDisabled', { cacheDisabled: true })
    // Runtime é o que dá console, erros não capturados e avaliação de
    // expressão — o mesmo caminho que o console do DevTools usa.
    await this.sendSafe('Runtime.enable')
    await this.sendSafe('Page.enable')
    await this.sendSafe('Fetch.enable', { patterns: INTERCEPT_PATTERNS })
    await this.refreshUserScripts()
  }

  async refreshUserScripts() {
    if (!this.attached) return
    for (const id of this.scriptIds) {
      await this.sendSafe('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
    }
    this.scriptIds = []
    const bundle = this.deps.getBundle()
    if (bundle) {
      const res = await this.sendSafe('Page.addScriptToEvaluateOnNewDocument', { source: bundle })
      if (res?.identifier) this.scriptIds.push(res.identifier)
    }
  }

  async setThrottle(preset: ThrottlePreset) {
    await this.sendSafe('Network.emulateNetworkConditions', THROTTLE_PRESETS[preset])
  }

  /**
   * Um `console.log` dentro de um laço geraria milhares de mensagens de IPC e
   * travaria a janela; o lote resolve isso do mesmo jeito que o log de rede.
   */
  private pushConsole(entry: ConsoleEntry) {
    // O próprio Electron loga avisos no renderer da página (CSP, por exemplo).
    // Isso não veio do site e apareceria em todo lugar: é ruído nosso.
    if (entry.origem?.startsWith('node:electron')) return
    this.consoleFila.push(entry)
    if (this.consoleFila.length > 500) this.consoleFila.splice(0, this.consoleFila.length - 500)
    if (this.consoleTimer) return
    this.consoleTimer = setTimeout(() => {
      this.consoleTimer = null
      const lote = this.consoleFila.splice(0)
      if (lote.length) this.deps.emitConsole(lote)
    }, 100)
  }

  clearConsole() {
    this.consoleFila = []
    this.deps.emitConsoleClear(this.tabId)
  }

  /** Avalia no mundo principal da página, com a API de linha de comando (`$0`, `$_`). */
  async evaluate(expression: string): Promise<{ ok: boolean; value?: RemoteValue; error?: string }> {
    try {
      const r = await this.send('Runtime.evaluate', {
        expression,
        includeCommandLineAPI: true,
        // replMode deixa redeclarar `let`/`const` entre avaliações
        replMode: true,
        returnByValue: false,
        generatePreview: true,
        awaitPromise: true,
        userGesture: true,
        allowUnsafeEvalBlockedByCSP: true
      })
      if (r.exceptionDetails) {
        const excecao = r.exceptionDetails.exception
        return {
          ok: false,
          error: excecao?.description ?? r.exceptionDetails.text ?? 'erro na avaliação',
          value: excecao ? toRemoteValue(excecao) : undefined
        }
      }
      return { ok: true, value: toRemoteValue(r.result) }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  }

  async getProperties(
    objectId: string
  ): Promise<{ ok: boolean; properties?: Array<{ name: string; value: RemoteValue }>; error?: string }> {
    try {
      const r = await this.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: true
      })
      const properties = (r.result ?? [])
        .filter((p: any) => p.value !== undefined)
        .map((p: any) => ({ name: String(p.name), value: toRemoteValue(p.value) }))
      return { ok: true, properties }
    } catch (err) {
      // objectId morre quando a página navega — a mensagem precisa dizer isso
      return { ok: false, error: 'o objeto não existe mais (a página recarregou?)' }
    }
  }

  async getBody(requestId: string): Promise<string> {
    const r = await this.send('Network.getResponseBody', { requestId })
    return r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
  }

  onMainFrameNavigation() {
    this.entries.clear()
    this.order = []
    this.dirty.clear()
    this.deps.emitNetClear(this.tabId)
  }

  clearLog() {
    this.onMainFrameNavigation()
  }

  private upsert(id: string, patch: Partial<NetEntry>, createWith?: NetEntry) {
    let e = this.entries.get(id)
    if (!e) {
      if (!createWith) return
      e = createWith
      this.entries.set(id, e)
      this.order.push(id)
      if (this.order.length > 1500) {
        for (const old of this.order.splice(0, 500)) this.entries.delete(old)
      }
    }
    Object.assign(e, patch)
    this.dirty.add(id)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 200)
  }

  private flush() {
    this.flushTimer = null
    if (this.dirty.size === 0) return
    const batch: NetEntry[] = []
    for (const id of this.dirty) {
      const e = this.entries.get(id)
      if (e) batch.push({ ...e })
    }
    this.dirty.clear()
    this.deps.emitNet(this.tabId, batch)
  }

  private onMessage(method: string, params: any) {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.upsert(
          params.requestId,
          {},
          {
            id: params.requestId,
            tabId: this.tabId,
            url: params.request?.url ?? '',
            method: params.request?.method ?? 'GET',
            resourceType: params.type ?? 'Other',
            startTime: Date.now()
          }
        )
        break
      case 'Network.responseReceived':
        this.upsert(params.requestId, {
          status: params.response?.status,
          statusText: params.response?.statusText,
          mimeType: params.response?.mimeType,
          fromCache: Boolean(params.response?.fromDiskCache || params.response?.fromPrefetchCache)
        })
        break
      case 'Network.loadingFinished':
        this.upsert(params.requestId, {
          encodedLength: params.encodedDataLength,
          endTime: Date.now()
        })
        break
      case 'Network.loadingFailed': {
        const existing = this.entries.get(params.requestId)
        this.upsert(params.requestId, {
          error: existing?.blocked ? existing.error : params.errorText,
          endTime: Date.now()
        })
        break
      }
      case 'Runtime.consoleAPICalled':
        this.pushConsole({
          id: `c${++this.consoleSeq}`,
          tabId: this.tabId,
          level: mapearNivel(params.type),
          args: (params.args ?? []).map(toRemoteValue),
          at: Date.now(),
          origem: origemDoStack(params.stackTrace)
        })
        break
      case 'Runtime.exceptionThrown': {
        const d = params.exceptionDetails ?? {}
        const objeto = d.exception ? toRemoteValue(d.exception) : undefined
        this.pushConsole({
          id: `c${++this.consoleSeq}`,
          tabId: this.tabId,
          level: 'error',
          args: [objeto ?? { type: 'string', value: d.text ?? 'erro desconhecido' }],
          at: Date.now(),
          origem: origemDoStack(d.stackTrace) ?? (d.url ? `${d.url}:${(d.lineNumber ?? 0) + 1}` : undefined),
          stack: formatarPilha(d.stackTrace)
        })
        break
      }
      case 'Runtime.executionContextsCleared':
        this.clearConsole()
        break
      case 'Fetch.requestPaused':
        this.handlePaused(params).catch((err) => {
          console.warn('[cdp] requestPaused:', err?.message ?? err)
        })
        break
    }
  }

  private async handlePaused(params: any) {
    const requestId: string = params.requestId
    const isResponse = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined

    try {
      if (!isResponse) {
        const url: string = params.request?.url ?? ''
        const rule = this.deps.getRules().find((r) => ruleMatches(r, url))
        if (rule) {
          if (params.networkId) {
            // Fetch.requestPaused pode chegar antes de Network.requestWillBeSent;
            // sem criar a entrada aqui, a marcação de bloqueio se perde e o dev
            // vê só uma requisição falhada, sem saber que foi o JWWW.
            this.upsert(
              params.networkId,
              { blocked: true, error: `bloqueado (${rule.pattern})` },
              {
                id: params.networkId,
                tabId: this.tabId,
                url,
                method: params.request?.method ?? 'GET',
                resourceType: params.resourceType ?? 'Other',
                startTime: Date.now()
              }
            )
          }
          await this.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
          return
        }
        await this.send('Fetch.continueRequest', { requestId })
        return
      }

      // Estágio de resposta: aplicar overrides sobre o corpo recém-baixado.
      const url = stripHash(params.request?.url ?? '')
      const status = params.responseStatusCode ?? 0
      const isDocument = params.resourceType === 'Document'
      const disableCsp = this.deps.getDisableCsp()
      const hasOverrides = this.deps.overrides.enabledFor(url).length > 0
      // Documentos também passam aqui sem override próprio: é neles que mora o
      // atributo `integrity` dos subrecursos e o meta CSP.
      const needsDocumentPass = isDocument && (this.deps.overrides.hasAny() || disableCsp)
      const badStatus = params.responseErrorReason || status < 200 || status >= 300

      if ((!hasOverrides && !needsDocumentPass) || badStatus) {
        await this.send('Fetch.continueRequest', { requestId })
        return
      }

      const bodyRes = await this.send('Fetch.getResponseBody', { requestId })
      const original: string = bodyRes.base64Encoded
        ? Buffer.from(bodyRes.body, 'base64').toString('utf8')
        : bodyRes.body

      let text = original
      if (hasOverrides) {
        const applied = this.deps.overrides.apply(url, text)
        text = applied.text
        for (const r of applied.results) {
          this.deps.emitOverrideStatus({ ...r, tabId: this.tabId })
        }
        if (applied.catalog) {
          this.deps.emitMapCatalog({
            tabId: this.tabId,
            url,
            fileId: applied.catalog.fileId,
            sourceMappingUrl: resolveMapUrl(original, url),
            functions: applied.catalog.functions
          })
        }
      }

      if (isDocument) {
        const sri = stripIntegrity(text, url, (u) => this.deps.overrides.enabledFor(u).length > 0)
        text = sri.text
        for (const stripped of sri.stripped) {
          this.deps.emitOverrideStatus({
            overrideId: `sri:${stripped}`,
            url: stripped,
            tabId: this.tabId,
            kind: 'sri',
            status: 'applied',
            label: 'SRI removido',
            message: `integrity removido de ${stripped} para o override poder ser aplicado.`
          })
        }
        if (disableCsp) text = stripMetaCsp(text)
      }

      const headersChanged = disableCsp && isDocument
      if (text === original && !headersChanged) {
        await this.send('Fetch.continueRequest', { requestId })
        return
      }

      if (params.networkId && text !== original) this.upsert(params.networkId, { overridden: true })

      // O corpo agora é texto puro em UTF-8: headers de encoding/tamanho precisam refletir isso.
      const headers = ((params.responseHeaders ?? []) as Array<{ name: string; value: string }>).filter(
        (h) =>
          !['content-encoding', 'content-length', 'transfer-encoding'].includes(h.name.toLowerCase()) &&
          !(disableCsp && isCspHeader(h.name))
      )
      // Sem charset explícito o Chrome cai em latin-1 e vira mojibake em qualquer acento.
      const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')
      if (ct && !/charset=/i.test(ct.value)) ct.value = `${ct.value}; charset=utf-8`
      else if (!ct) headers.push({ name: 'content-type', value: 'text/plain; charset=utf-8' })
      headers.push({ name: 'content-length', value: String(Buffer.byteLength(text, 'utf8')) })

      await this.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: headers,
        body: Buffer.from(text, 'utf8').toString('base64')
      })
    } catch {
      try {
        await this.send('Fetch.continueRequest', { requestId })
      } catch {}
    }
  }
}
