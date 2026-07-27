import { useState } from 'react'
import {
  Ban,
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatBytes, isTextual } from '@/lib/lang'
import { openResourceInEditor } from '@/lib/editor'
import type { TreeNode } from '@/lib/tree'
import type { NetEntry } from '@shared/types'

function typeIcon(entry: NetEntry) {
  switch (entry.resourceType) {
    case 'Script':
      return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
    case 'Stylesheet':
      return <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
    case 'Document':
      return <FileText className="h-3.5 w-3.5 shrink-0 text-orange-400" />
    case 'XHR':
    case 'Fetch':
      return <Braces className="h-3.5 w-3.5 shrink-0 text-violet-400" />
    case 'Image':
      return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
    default:
      return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
}

type Props = {
  node: TreeNode
  depth: number
  emphasized: boolean
  isExpanded: (id: string) => boolean
  toggle: (id: string) => void
}

export function ResourceTreeNode({ node, depth, emphasized, isExpanded, toggle }: Props) {
  const indent = { paddingLeft: `${depth * 12 + 6}px` }

  if (node.entry) {
    const entry = node.entry
    const clickable = isTextual(entry)
    return (
      <div
        style={indent}
        onClick={() => clickable && openResourceInEditor(entry)}
        title={entry.url}
        className={cn(
          'group flex items-center gap-1.5 rounded-md py-[3px] pr-2 text-xs',
          clickable ? 'cursor-pointer hover:bg-secondary/60' : 'cursor-default',
          emphasized ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {typeIcon(entry)}
        <span className={cn('min-w-0 flex-1 truncate font-mono', emphasized && 'font-medium')}>{node.name}</span>
        {entry.overridden && (
          <Badge variant="outline" className="h-4 shrink-0 border-amber-500/50 px-1 text-[9px] text-amber-400">
            override
          </Badge>
        )}
        {entry.blocked && (
          <Badge variant="outline" className="h-4 shrink-0 border-red-500/50 px-1 text-[9px] text-red-400">
            <Ban className="mr-0.5 h-2 w-2" /> bloq.
          </Badge>
        )}
        {entry.status !== undefined && entry.status >= 400 && (
          <span className="shrink-0 text-[10px] text-red-400">{entry.status}</span>
        )}
        <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {formatBytes(entry.encodedLength)}
        </span>
      </div>
    )
  }

  const isOpen = isExpanded(node.id)
  return (
    <div>
      <div
        style={indent}
        onClick={() => toggle(node.id)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md py-[3px] pr-2 text-xs text-muted-foreground hover:bg-secondary/40"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {isOpen ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{node.count}</span>
      </div>
      {isOpen &&
        node.children.map((child) => (
          <ResourceTreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            emphasized={emphasized}
            isExpanded={isExpanded}
            toggle={toggle}
          />
        ))}
    </div>
  )
}

/** Pastas começam abertas; guardamos apenas o que o dev fechou. */
export function useTreeExpansion() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  return {
    isExpanded: (id: string) => !collapsed.has(id),
    toggle: (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
  }
}
