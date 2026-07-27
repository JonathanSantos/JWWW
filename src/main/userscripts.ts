import type { UserScript } from '@shared/schemas'

const MATCH_HELPER =
  'const __jwwwMatch = (pattern, url) => {\n' +
  '  try {\n' +
  "    const esc = (s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\n" +
  "    const re = new RegExp('^' + pattern.split('*').map(esc).join('.*') + '$');\n" +
  '    return re.test(url);\n' +
  '  } catch (e) { return false }\n' +
  '};'

function wrapScript(s: UserScript): string {
  const tag = JSON.stringify(`[JWWW userscript: ${s.name}]`)
  const patterns = `[${s.matches.map((m) => JSON.stringify(m)).join(', ')}]`
  const trigger =
    s.runAt === 'document-end'
      ? "if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __run); } else { __run(); }"
      : '__run();'
  return `;(() => { try {
  if (!${patterns}.some((p) => __jwwwMatch(p, location.href))) return;
  const __run = () => { try {
${s.code}
  } catch (e) { console.error(${tag}, e) } };
  ${trigger}
} catch (e) { console.error(${tag}, e) } })();`
}

/**
 * Gera um bundle único injetado via Page.addScriptToEvaluateOnNewDocument.
 * Roda no mundo da página (mesma origem do site), em toda navegação;
 * cada script decide sozinho se a URL casa com seus padrões.
 */
export function buildUserScriptBundle(scripts: UserScript[]): string | null {
  const enabled = scripts.filter((s) => s.enabled)
  if (enabled.length === 0) return null
  return `;(() => {\n${MATCH_HELPER}\n${enabled.map(wrapScript).join('\n')}\n})();`
}
