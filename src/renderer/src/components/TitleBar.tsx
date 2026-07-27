import { Plus, X, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

export function TitleBar() {
  const tabs = useApp((s) => s.tabs)

  return (
    <div className="app-drag flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background pl-[84px] pr-2">
      <div className="app-no-drag flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => window.api.tabs.activate(tab.id)}
            className={cn(
              'group flex h-7 min-w-0 max-w-[190px] shrink-0 cursor-default items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
              tab.active
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            )}
          >
            {tab.favicon ? (
              <img src={tab.favicon} className="h-3.5 w-3.5 shrink-0" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <Globe className="h-3 w-3 shrink-0 opacity-50" />
            )}
            <span className="min-w-0 truncate">{tab.loading ? '…' : ''}{tab.title || 'Nova aba'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.api.tabs.close(tab.id)
              }}
              className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => window.api.tabs.create()}
        className="app-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        title="Nova aba (⌘T)"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
