import { collectInstrumentable, parses } from '@shared/analyze'
import { offsetToPosition } from '@shared/sourcemap'
import { LIMITE_FUNCOES } from '@shared/limits'
import type { MapFunction } from '@shared/types'
import type { OverrideStatus } from '@shared/types'

/**
 * Runtime do mapa de execução. Ao contrário do runtime de observação, este
 * **agrega na página** e envia em lotes: uma função dentro de um laço geraria
 * dezenas de milhares de mensagens por segundo e afogaria o IPC.
 *
 * Também não serializa argumentos nem retorno — só conta e cronometra. É o que
 * torna viável instrumentar o bundle inteiro.
 */
export const MAP_RUNTIME = `;(() => {
  if (globalThis.__jwwwMap) return;
  var contadores = new Map();
  var agendado = false;
  var agora = (globalThis.performance && performance.now) ? function () { return performance.now() } : function () { return 0 };

  function enviar() {
    agendado = false;
    if (contadores.size === 0) return;
    var lote = [];
    contadores.forEach(function (v) { lote.push([v.arquivo, v.id, v.c, Math.round(v.t * 100) / 100]) });
    contadores.clear();
    try {
      if (globalThis.jwww && globalThis.jwww._map) globalThis.jwww._map({ lote: lote });
    } catch (e) {}
  }

  // A chave inclui o arquivo: dois bundles mapeados numerariam suas funções a
  // partir de zero e as contagens se misturariam.
  function registrar(arquivo, id, ms) {
    var chave = arquivo + '|' + id;
    var e = contadores.get(chave);
    if (e) { e.c++; e.t += ms } else { contadores.set(chave, { arquivo: arquivo, id: id, c: 1, t: ms }) }
    if (!agendado) { agendado = true; setTimeout(enviar, 400) }
  }

  globalThis.__jwwwMap = function (arquivo, id, fn) {
    if (typeof fn !== 'function') return fn;
    function embrulho() {
      var t0 = agora();
      try {
        // sem isto, \`new Classe()\` deixaria de construir
        if (new.target) return Reflect.construct(fn, arguments, new.target);
        return fn.apply(this, arguments);
      } finally {
        registrar(arquivo, id, agora() - t0);
      }
    }
    try {
      Object.defineProperty(embrulho, 'name', { value: fn.name, configurable: true });
      Object.defineProperty(embrulho, 'length', { value: fn.length, configurable: true });
      if (fn.prototype) embrulho.prototype = fn.prototype;
    } catch (e) {}
    return embrulho;
  };
})();`

export type MapResult = {
  text: string
  catalog: MapFunction[]
  status: OverrideStatus
  message?: string
}

export function contarFuncoes(body: string): number {
  return collectInstrumentable(body).length
}

/**
 * Instrumenta todas as funções do arquivo. Só usa inserções em pontos — nunca
 * substitui intervalos —, então funções aninhadas não conflitam entre si.
 */
export function applyExecutionMap(body: string, fileId: string): MapResult {
  const funcoes = collectInstrumentable(body)
  if (funcoes.length === 0) {
    return {
      text: body,
      catalog: [],
      status: 'failed',
      message: 'Nenhuma função instrumentável encontrada neste arquivo.'
    }
  }
  if (funcoes.length > LIMITE_FUNCOES) {
    return {
      text: body,
      catalog: [],
      status: 'failed',
      message: `Arquivo com ${funcoes.length} funções — acima do limite de ${LIMITE_FUNCOES}. Mapear travaria a página.`
    }
  }

  type Insercao = { pos: number; texto: string; fecha: boolean }
  const insercoes: Insercao[] = []

  const arquivo = JSON.stringify(fileId)
  for (const f of funcoes) {
    if (f.declaration && f.name) {
      insercoes.push({
        pos: f.end,
        texto: `\n;try{${f.name}=globalThis.__jwwwMap(${arquivo},${f.id},${f.name})}catch(e){}\n`,
        fecha: false
      })
    } else {
      insercoes.push({ pos: f.start, texto: `globalThis.__jwwwMap(${arquivo},${f.id},`, fecha: false })
      insercoes.push({ pos: f.end, texto: ')', fecha: true })
    }
  }

  // Da direita para a esquerda: assim cada inserção não desloca as anteriores.
  // No empate, a que fecha entra primeiro para acabar à direita da que abre.
  insercoes.sort((a, b) => b.pos - a.pos || Number(b.fecha) - Number(a.fecha))

  let texto = body
  for (const i of insercoes) {
    texto = texto.slice(0, i.pos) + i.texto + texto.slice(i.pos)
  }

  if (parses(body) && !parses(texto)) {
    return {
      text: body,
      catalog: [],
      status: 'failed',
      message: 'A instrumentação quebraria a sintaxe do arquivo. Servindo o original.'
    }
  }

  const catalog: MapFunction[] = funcoes.map((f) => {
    const pos = offsetToPosition(body, f.start)
    const posNome = offsetToPosition(body, f.nameOffset)
    return {
      id: f.id,
      name: f.name,
      nodeType: f.nodeType,
      start: f.start,
      end: f.end,
      line: pos.line,
      column: pos.column,
      nameLine: posNome.line,
      nameColumn: posNome.column
    }
  })

  return { text: texto, catalog, status: 'applied' }
}
