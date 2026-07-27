import * as acorn from 'acorn'

/**
 * Análise estrutural de JS usada tanto pelo motor de overrides quanto pela UI.
 *
 * Regra do projeto: o AST serve para **entender e localizar**, nunca para gerar
 * código. Regenerar a partir da árvore produziria um arquivo com formatação
 * diferente do original e destruiria o fuzzy patch, que é a base de tudo aqui.
 * Por isso tudo devolve offsets, e quem chama faz edição textual cirúrgica.
 */

const OPTS: acorn.Options = {
  ecmaVersion: 'latest',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowSuperOutsideMethod: true,
  allowHashBang: true
}

export type AnyNode = acorn.Node & Record<string, any>

export function parseProgram(text: string): AnyNode | null {
  for (const sourceType of ['script', 'module'] as const) {
    try {
      return acorn.parse(text, { ...OPTS, sourceType }) as AnyNode
    } catch {
      // tenta o próximo modo
    }
  }
  return null
}

export function parses(text: string): boolean {
  return parseProgram(text) !== null
}

export function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  const candidate = node as AnyNode
  if (typeof candidate.type === 'string') visit(candidate)
  for (const key of Object.keys(candidate)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    walk(candidate[key], visit)
  }
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression'
])

const STATEMENT_SUFFIX = /Statement$|Declaration$/

export type SelectionKind = 'function' | 'expression' | 'declaration' | 'other'

export type SelectionInfo = {
  kind: SelectionKind
  nodeType: string
  name: string | null
  params: string[]
  isAsync: boolean
  isGenerator: boolean
  /** offsets do nó no texto analisado — a seleção do dev pode ser menor */
  start: number
  end: number
  /** declaração de função nomeada: o binding pode ser reatribuído com segurança */
  reassignable: boolean
}

function nameOf(node: AnyNode, parent: AnyNode | null): string | null {
  if (node.id?.name) return node.id.name
  if (!parent) return null
  if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name
  if (parent.type === 'Property' && parent.key) return parent.key.name ?? parent.key.value ?? null
  if (parent.type === 'MethodDefinition' && parent.key) return parent.key.name ?? null
  if (parent.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') return parent.left.name
  return null
}

function paramsOf(node: AnyNode): string[] {
  if (!Array.isArray(node.params)) return []
  return node.params.map((p: AnyNode) => {
    if (p.type === 'Identifier') return p.name
    if (p.type === 'RestElement' && p.argument?.name) return `...${p.argument.name}`
    if (p.type === 'AssignmentPattern' && p.left?.name) return `${p.left.name}=…`
    if (p.type === 'ObjectPattern') return '{…}'
    if (p.type === 'ArrayPattern') return '[…]'
    return '…'
  })
}

function classify(node: AnyNode): SelectionKind {
  if (FUNCTION_TYPES.has(node.type)) return 'function'
  if (node.type === 'ClassDeclaration' || node.type === 'VariableDeclaration') return 'declaration'
  if (node.type.endsWith('Expression') || node.type === 'Identifier' || node.type === 'Literal') {
    return 'expression'
  }
  return 'other'
}

/**
 * Descreve o menor nó relevante que cobre o intervalo selecionado. Quando a
 * seleção cai dentro de uma função (por exemplo só o nome dela), sobe até a
 * função — é isso que o dev quer dizer com "observar este trecho".
 */
export function describeRange(text: string, start: number, end: number): SelectionInfo | null {
  const program = parseProgram(text)
  if (!program) return null

  const parents = new Map<AnyNode, AnyNode | null>()
  const covering: AnyNode[] = []

  const visitWithParent = (node: AnyNode, parent: AnyNode | null) => {
    parents.set(node, parent)
    if (node.start <= start && node.end >= end) covering.push(node)
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      const child = node[key]
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && typeof c.type === 'string') visitWithParent(c, node)
        }
      } else if (child && typeof child === 'object' && typeof child.type === 'string') {
        visitWithParent(child, node)
      }
    }
  }
  visitWithParent(program, null)

  if (covering.length === 0) return null
  covering.sort((a, b) => a.end - a.start - (b.end - b.start))

  // Ordem importa: se a seleção bate exatamente com um nó, é esse nó que o dev
  // quis — subir para a função que o contém instrumentaria outra coisa. Só
  // quando a seleção é um pedaço solto (sem nó correspondente) subimos para a
  // função que a envolve.
  const exact = covering.find((n) => n.start === start && n.end === end)
  const fn = covering.find((n) => FUNCTION_TYPES.has(n.type))
  const chosen = exact ?? fn ?? covering[0]
  if (chosen.type === 'Program') return null

  const parent = parents.get(chosen) ?? null
  return {
    kind: classify(chosen),
    nodeType: chosen.type,
    name: nameOf(chosen, parent),
    params: paramsOf(chosen),
    isAsync: Boolean(chosen.async),
    isGenerator: Boolean(chosen.generator),
    start: chosen.start,
    end: chosen.end,
    reassignable: chosen.type === 'FunctionDeclaration' && Boolean(chosen.id?.name)
  }
}

/** Lista as funções do arquivo, para a UI oferecer "o que observar". */
export function listFunctions(text: string): SelectionInfo[] {
  const program = parseProgram(text)
  if (!program) return []
  const found: SelectionInfo[] = []
  const seen = new Set<AnyNode>()

  const visitWithParent = (node: AnyNode, parent: AnyNode | null) => {
    if (FUNCTION_TYPES.has(node.type) && !seen.has(node)) {
      seen.add(node)
      found.push({
        kind: 'function',
        nodeType: node.type,
        name: nameOf(node, parent),
        params: paramsOf(node),
        isAsync: Boolean(node.async),
        isGenerator: Boolean(node.generator),
        start: node.start,
        end: node.end,
        reassignable: node.type === 'FunctionDeclaration' && Boolean(node.id?.name)
      })
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      const child = node[key]
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && typeof c.type === 'string') visitWithParent(c, node)
        }
      } else if (child && typeof child === 'object' && typeof child.type === 'string') {
        visitWithParent(child, node)
      }
    }
  }
  visitWithParent(program, null)
  return found
}

/** O trecho isolado é uma expressão? (usado quando não dá para analisar o arquivo todo) */
export function isExpressionSnippet(snippet: string): boolean {
  try {
    const prog = acorn.parse(`(${snippet}\n)`, OPTS) as AnyNode
    return prog.body.length === 1 && prog.body[0].type === 'ExpressionStatement'
  } catch {
    return false
  }
}

/** Nomes declarados por um trecho isolado (`function f`, `class C`, `const a, b`). */
export function declaredNames(snippet: string): string[] {
  const prog = parseProgram(snippet)
  if (!prog?.body || prog.body.length !== 1) return []
  const node = prog.body[0] as AnyNode
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id?.name) {
    return [node.id.name]
  }
  if (node.type === 'VariableDeclaration') {
    return node.declarations
      .filter((d: AnyNode) => d.id?.type === 'Identifier')
      .map((d: AnyNode) => d.id.name)
  }
  return []
}

/** Rótulo curto para a UI: `função soma(a, b)`, `expressão`, … */
export function describeForHumans(info: SelectionInfo): string {
  if (info.kind === 'function') {
    const nome = info.name ? ` ${info.name}` : ' anônima'
    const assinatura = `(${info.params.join(', ')})`
    const prefixo = info.isAsync ? 'função async' : info.isGenerator ? 'função geradora' : 'função'
    return `${prefixo}${nome}${assinatura}`
  }
  if (info.kind === 'declaration') return info.name ? `declaração de ${info.name}` : 'declaração'
  if (info.kind === 'expression') return info.name ? `expressão (${info.name})` : 'expressão'
  return info.nodeType
}
