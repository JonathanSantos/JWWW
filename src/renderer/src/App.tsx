import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Toaster, toast } from 'sonner'
import { useApp } from '@/store/app'
import { TitleBar } from '@/components/TitleBar'
import { NavBar } from '@/components/NavBar'
import { PageViewport } from '@/components/PageViewport'
import { DevPanel } from '@/components/devpanel/DevPanel'

export default function App() {
  const panelOpen = useApp((s) => s.panelOpen)

  useEffect(() => {
    const s = useApp.getState()
    const refreshOverrides = () => window.api.overrides.list().then(s.setOverrides)
    const refreshScripts = () => window.api.scripts.list().then(s.setScripts)
    const refreshRules = () => window.api.rules.list().then(s.setRules)
    const refreshWorkspaces = () => window.api.workspaces.list().then(s.setWorkspaces)

    const subs = [
      window.api.on('tabs:state', s.setTabs),
      window.api.on('net:upsert', s.upsertNet),
      window.api.on('net:clear', s.clearNet),
      window.api.on('override:status', (ev) => {
        s.pushStatus(ev)
        if (ev.status === 'failed') {
          toast.error('Override não aplicado', { description: ev.message })
        } else if (ev.status === 'fuzzy') {
          toast.warning('Override aplicado com fuzzy patch', { description: ev.message })
        } else if (ev.kind === 'sri') {
          toast.info('SRI ajustado', { description: ev.message })
        }
      }),
      window.api.on('bus:message', s.pushBus),
      window.api.on('overrides:changed', refreshOverrides),
      window.api.on('scripts:changed', refreshScripts),
      window.api.on('rules:changed', refreshRules),
      window.api.on('workspaces:changed', refreshWorkspaces),
      window.api.on('ui:toggle-panel', s.togglePanel)
    ]

    window.api.tabs.list().then(s.setTabs)
    refreshOverrides()
    refreshScripts()
    refreshRules()
    refreshWorkspaces()
    window.api.bus.history().then(s.setBusLog)

    return () => subs.forEach((u) => u())
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <NavBar />
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={60} minSize={25}>
            <PageViewport />
          </Panel>
          {panelOpen && (
            <>
              <PanelResizeHandle className="w-[3px] bg-border transition-colors hover:bg-ring data-[resize-handle-state=drag]:bg-ring" />
              <Panel defaultSize={40} minSize={22}>
                <DevPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  )
}
