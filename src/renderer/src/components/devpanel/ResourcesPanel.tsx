import { useMemo, useState } from 'react'
import { getDomain } from 'tldts'
import { FolderTree, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useActiveTab, useApp } from '@/store/app'
import { hostOf } from '@/lib/lang'
import { buildTree } from '@/lib/tree'
import { ResourceTreeNode, useTreeExpansion } from './ResourceTree'
import type { NetEntry } from '@shared/types'

const LISTED_TYPES = new Set([
  'Document',
  'Stylesheet',
  'Script',
  'XHR',
  'Fetch',
  'Image',
  'Media',
  'Font',
  'Manifest',
  'EventSource',
  'Other'
])

const EMPTY: NetEntry[] = []

export function ResourcesPanel() {
  const active = useActiveTab()
  const entries = useApp((s) => (active ? s.net[active.id] : undefined)) ?? EMPTY
  const [query, setQuery] = useState('')
  const [flat, setFlat] = useState(false)
  const statusPorUrl = useApp((s) => s.statusPorUrl)
  const { isExpanded, toggle } = useTreeExpansion()

  const { firstParty, thirdParty, pageDomain } = useMemo(() => {
    // getDomain() devolve null para hosts fora da PSL (localhost, IPs, .local),
    // que é justamente o dia a dia de quem desenvolve — cai no hostname.
    const pageDomain = active ? getDomain(active.url) || hostOf(active.url) || null : null
    const seen = new Map<string, NetEntry>()
    for (const e of entries) {
      if (!LISTED_TYPES.has(e.resourceType)) continue
      if (!e.url.startsWith('http')) continue
      if (query && !e.url.toLowerCase().includes(query.toLowerCase())) continue
      seen.set(e.url, e) // dedup por URL, mantendo a entrada mais recente
    }

    const byOrigin = new Map<string, NetEntry[]>()
    const firstPartyEntries: NetEntry[] = []
    for (const e of seen.values()) {
      const domain = getDomain(e.url) || hostOf(e.url) || '?'
      if (pageDomain && domain === pageDomain) {
        firstPartyEntries.push(e)
      } else {
        const list = byOrigin.get(domain) ?? []
        list.push(e)
        byOrigin.set(domain, list)
      }
    }

    return {
      firstParty: firstPartyEntries,
      thirdParty: [...byOrigin.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      pageDomain
    }
  }, [entries, active?.url, query])

  const renderGroup = (label: string, list: NetEntry[], emphasized: boolean) => {
    if (list.length === 0) return null
    if (flat) {
      return (
        <div key={label} className="mb-1.5">
          <div className="px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">{label}</div>
          {list
            .slice()
            .sort((a, b) => a.url.localeCompare(b.url))
            .map((e) => (
              <ResourceTreeNode
                key={e.url}
                node={{ name: e.url.replace(/^https?:\/\//, ''), id: e.url, children: [], entry: e, count: 1 }}
                depth={0}
                emphasized={emphasized}
                isExpanded={isExpanded}
                toggle={toggle}
                statusPorUrl={statusPorUrl}
              />
            ))}
        </div>
      )
    }
    const tree = buildTree(list, label)
    return (
      <ResourceTreeNode
        key={label}
        node={tree}
        depth={0}
        emphasized={emphasized}
        isExpanded={isExpanded}
        toggle={toggle}
        statusPorUrl={statusPorUrl}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar recursos…"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 select-text rounded-md bg-secondary/60 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:bg-secondary"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={flat ? 'Ver como árvore de pastas' : 'Ver como lista plana'}
          onClick={() => setFlat((v) => !v)}
        >
          {flat ? <FolderTree className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!active && <p className="p-4 text-center text-xs text-muted-foreground">Nenhuma aba ativa.</p>}
        {active && firstParty.length === 0 && thirdParty.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nada capturado ainda — recarregue a página (⌘R).
          </p>
        )}

        {firstParty.length > 0 && (
          <section className="mb-3">
            <h3 className="mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/90">
              Este domínio <span className="ml-1 font-mono normal-case text-emerald-400">{pageDomain}</span>
            </h3>
            {renderGroup(pageDomain ?? 'este domínio', firstParty, true)}
          </section>
        )}

        {thirdParty.length > 0 && (
          <section>
            <h3 className={cn('mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground')}>
              Terceiros
            </h3>
            {thirdParty.map(([domain, list]) => renderGroup(domain, list, false))}
          </section>
        )}
      </div>
    </div>
  )
}
