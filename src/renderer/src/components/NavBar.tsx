import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Code2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useActiveTab, useApp } from '@/store/app'
import { hostOf } from '@/lib/lang'

export function NavBar() {
  const active = useActiveTab()
  const panelOpen = useApp((s) => s.panelOpen)
  const togglePanel = useApp((s) => s.togglePanel)
  const setPanelTab = useApp((s) => s.setPanelTab)
  const overrides = useApp((s) => s.overrides)

  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) {
      const url = active?.url ?? ''
      setText(url === 'about:blank' ? '' : url)
    }
  }, [active?.url, active?.id, editing])

  useEffect(() => {
    if (active && (active.url === 'about:blank' || !active.url)) {
      inputRef.current?.focus()
    }
  }, [active?.id, active?.url])

  // ⌘L: o atalho que todo navegador tem para ir direto ao endereço
  useEffect(() => {
    return window.api.on('ui:focus-url', () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const host = active ? hostOf(active.url) : ''
  const overridesForHost = overrides.filter(
    (o) => o.enabled && host && hostOf(o.pattern ?? o.url) === host
  ).length

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!active?.canGoBack}
        onClick={() => active && window.api.tabs.back(active.id)}
        title="Voltar (⌘[)"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!active?.canGoForward}
        onClick={() => active && window.api.tabs.forward(active.id)}
        title="Avançar (⌘])"
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!active}
        onClick={() => active && window.api.tabs.reload(active.id)}
        title="Recarregar (⌘R)"
      >
        <RotateCw className="h-4 w-4" />
      </Button>

      <form
        className="min-w-0 flex-1 px-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          if (active) {
            window.api.tabs.navigate(active.id, text)
          } else {
            window.api.tabs.create(text)
          }
          inputRef.current?.blur()
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false)
              inputRef.current?.blur()
            }
          }}
          placeholder="Digite uma URL ou pesquise…"
          spellCheck={false}
          className="h-8 w-full select-text rounded-md border border-transparent bg-secondary/60 px-3 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring/60 focus:bg-secondary"
        />
      </form>

      {overridesForHost > 0 && (
        <Badge
          variant="secondary"
          className="cursor-pointer text-[10px] text-amber-400"
          onClick={() => setPanelTab('overrides')}
          title="Overrides ativos para este host"
        >
          {overridesForHost} override{overridesForHost > 1 ? 's' : ''}
        </Badge>
      )}

      <Button
        variant={panelOpen ? 'secondary' : 'ghost'}
        size="icon"
        className="h-7 w-7"
        onClick={togglePanel}
        title="Painel dev (⌘⇧D)"
      >
        <Code2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
