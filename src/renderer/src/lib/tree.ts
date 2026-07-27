import type { NetEntry } from '@shared/types'

export type TreeNode = {
  /** rótulo exibido — pode ser um caminho colapsado tipo "assets/js" */
  name: string
  /** chave estável para estado de expansão */
  id: string
  children: TreeNode[]
  /** presente só em folhas */
  entry?: NetEntry
  /** total de arquivos abaixo deste nó */
  count: number
}

type Building = {
  name: string
  id: string
  children: Map<string, Building>
  entry?: NetEntry
}

function emptyNode(name: string, id: string): Building {
  return { name, id, children: new Map(), entry: undefined }
}

/**
 * Monta a hierarquia origem → pastas do path → arquivo, como o painel Sources
 * do DevTools. Pastas com um único filho são colapsadas ("assets/js/vendor"),
 * que é o que evita a escadinha inútil em builds modernos.
 */
export function buildTree(entries: NetEntry[], rootLabel: string): TreeNode {
  const root = emptyNode(rootLabel, rootLabel)

  for (const entry of entries) {
    let url: URL
    try {
      url = new URL(entry.url)
    } catch {
      continue
    }
    const segments = url.pathname.split('/').filter(Boolean)
    const fileName = (segments.pop() ?? '') + (url.search || '')
    let node = root
    let path = rootLabel

    for (const seg of segments) {
      path += '/' + seg
      let child = node.children.get(seg)
      if (!child) {
        child = emptyNode(seg, path)
        node.children.set(seg, child)
      }
      node = child
    }

    const leafName = fileName || '(índice)'
    const leafId = path + '/' + leafName
    node.children.set(leafId, { ...emptyNode(leafName, leafId), entry })
  }

  return finalize(root)
}

function finalize(node: Building): TreeNode {
  if (node.entry) {
    return { name: node.name, id: node.id, children: [], entry: node.entry, count: 1 }
  }

  let children = [...node.children.values()].map(finalize)

  // Colapsa cadeias de pasta única: a/b/c com um filho vira um nó só.
  while (children.length === 1 && !children[0].entry) {
    const only = children[0]
    node = { ...node, name: `${node.name}/${only.name}`, id: only.id }
    children = only.children
  }

  children.sort((a, b) => {
    const aFolder = a.children.length > 0 || !a.entry
    const bFolder = b.children.length > 0 || !b.entry
    if (aFolder !== bFolder) return aFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return {
    name: node.name,
    id: node.id,
    children,
    count: children.reduce((n, c) => n + c.count, 0)
  }
}
