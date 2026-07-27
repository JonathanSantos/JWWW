import { describeRange, parses } from '@shared/analyze'
import type { OverrideEntry } from '@shared/schemas'
import type { OverrideStatus } from '@shared/types'

/**
 * Runtime injetado antes de qualquer script da página. Envolve a função (ou
 * expressão) observada e reporta cada execução pelo bridge do preload.
 */
export const WATCH_RUNTIME = `;(() => {
  if (globalThis.__jwwwWatch) return;
  var MAX_KEYS = 12;
  function preview(v, depth) {
    depth = depth || 0;
    try {
      if (v === null) return null;
      var t = typeof v;
      if (t === 'undefined') return '(undefined)';
      if (t === 'function') return 'ƒ ' + (v.name || '(anônima)');
      if (t === 'symbol' || t === 'bigint') return String(v);
      if (t !== 'object') return v;
      if (v instanceof Error) return v.name + ': ' + v.message;
      if (typeof Node !== 'undefined' && v instanceof Node) {
        return '<' + String(v.nodeName).toLowerCase() + '>';
      }
      if (depth >= 2) return Array.isArray(v) ? '[' + v.length + ' itens]' : '{…}';
      if (Array.isArray(v)) {
        var arr = v.slice(0, MAX_KEYS).map(function (x) { return preview(x, depth + 1) });
        if (v.length > MAX_KEYS) arr.push('… +' + (v.length - MAX_KEYS));
        return arr;
      }
      var out = {};
      var keys = Object.keys(v).slice(0, MAX_KEYS);
      for (var i = 0; i < keys.length; i++) out[keys[i]] = preview(v[keys[i]], depth + 1);
      return out;
    } catch (e) { return '(não serializável)' }
  }
  function callerStack() {
    try {
      var linhas = String(new Error().stack || '').split('\\n');
      // descarta os quadros do próprio runtime
      return linhas.slice(3, 9).map(function (l) { return l.trim() }).join('\\n');
    } catch (e) { return null }
  }
  function report(evt) {
    try {
      evt.at = Date.now();
      evt.url = location.href;
      if (globalThis.__jwwwBridge) globalThis.__jwwwBridge.watch(evt);
    } catch (e) {}
  }
  function watch(label, fn, opts) {
    opts = opts || {};
    if (typeof fn !== 'function') return fn;
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var t0 = (globalThis.performance && performance.now()) || 0;
      var base = { label: label, kind: 'call', args: preview(args) };
      if (opts.stack) base.stack = callerStack();
      try {
        var r = fn.apply(this, arguments);
        if (r && typeof r.then === 'function') {
          return r.then(
            function (v) {
              report(Object.assign({}, base, { result: preview(v), ms: ((globalThis.performance && performance.now()) || 0) - t0, async: true }));
              return v;
            },
            function (e) {
              report(Object.assign({}, base, { error: preview(e), ms: ((globalThis.performance && performance.now()) || 0) - t0, async: true }));
              throw e;
            }
          );
        }
        report(Object.assign({}, base, { result: preview(r), ms: ((globalThis.performance && performance.now()) || 0) - t0 }));
        return r;
      } catch (e) {
        report(Object.assign({}, base, { error: preview(e), ms: ((globalThis.performance && performance.now()) || 0) - t0 }));
        throw e;
      }
    };
  }
  watch.value = function (label, v, opts) {
    var evt = { label: label, kind: 'value', result: preview(v) };
    if (opts && opts.stack) evt.stack = callerStack();
    report(evt);
    return v;
  };
  globalThis.__jwwwWatch = watch;
})();`

type WatchSpec = NonNullable<OverrideEntry['watch']>

function locate(body: string, selection: string, prefix: string, suffix: string): number {
  const positions: number[] = []
  let i = body.indexOf(selection)
  while (i !== -1 && positions.length < 64) {
    positions.push(i)
    i = body.indexOf(selection, i + 1)
  }
  if (positions.length === 0) return -1
  if (positions.length === 1) return positions[0]

  let best = positions[0]
  let bestScore = -1
  for (const pos of positions) {
    const before = body.slice(Math.max(0, pos - prefix.length), pos)
    const after = body.slice(pos + selection.length, pos + selection.length + suffix.length)
    let score = 0
    for (let k = 1; k <= Math.min(before.length, prefix.length); k++) {
      if (before[before.length - k] === prefix[prefix.length - k]) score++
      else break
    }
    for (let k = 0; k < Math.min(after.length, suffix.length); k++) {
      if (after[k] === suffix[k]) score++
      else break
    }
    if (score > bestScore) {
      bestScore = score
      best = pos
    }
  }
  return best
}

export type WatchResult = { text: string; status: OverrideStatus; message?: string }

/**
 * Instrumenta o trecho observado. A edição é textual e cirúrgica: só o intervalo
 * exato do nó é tocado, então o resto do arquivo continua byte a byte igual ao
 * que o servidor entregou.
 */
export function applyWatch(body: string, spec: WatchSpec): WatchResult {
  const { label, selection, prefix, suffix, stack } = spec
  const pos = locate(body, selection, prefix, suffix)
  if (pos === -1) {
    return {
      text: body,
      status: 'failed',
      message: `Trecho observado "${label}" não encontrado — o arquivo mudou no servidor. Refaça a seleção.`
    }
  }

  const info = describeRange(body, pos, pos + selection.length)
  if (!info) {
    return {
      text: body,
      status: 'failed',
      message: `Não foi possível entender a estrutura de "${label}" neste arquivo.`
    }
  }

  const labelLit = JSON.stringify(label)
  const optsLit = stack ? ', { stack: true }' : ''
  const nodeText = body.slice(info.start, info.end)
  let transformed: string | null = null

  if (info.kind === 'function') {
    if (info.reassignable && info.name) {
      // Declaração de função: o binding é reatribuível, então embrulhamos depois
      // dela — assim o hoisting continua valendo para quem chama antes.
      const injection = `\n;try { ${info.name} = globalThis.__jwwwWatch(${labelLit}, ${info.name}${optsLit}); } catch (e) {}\n`
      transformed = body.slice(0, info.end) + injection + body.slice(info.end)
    } else {
      // Função em posição de expressão: troca pelo embrulho no lugar.
      const replacement = `globalThis.__jwwwWatch(${labelLit}, ${nodeText}${optsLit})`
      transformed = body.slice(0, info.start) + replacement + body.slice(info.end)
    }
  } else if (info.kind === 'expression') {
    const replacement = `globalThis.__jwwwWatch.value(${labelLit}, (${nodeText})${optsLit})`
    transformed = body.slice(0, info.start) + replacement + body.slice(info.end)
  }

  if (transformed === null) {
    return {
      text: body,
      status: 'failed',
      message: `"${label}" não é função nem expressão — só dá para observar esses dois com segurança.`
    }
  }

  // Se o arquivo original parseava e o instrumentado não, a instrumentação
  // quebraria o site: reverte e avisa.
  if (parses(body) && !parses(transformed)) {
    return {
      text: body,
      status: 'failed',
      message: `Observar "${label}" quebraria a sintaxe do arquivo. Servindo o original.`
    }
  }

  return { text: transformed, status: 'applied' }
}
