import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApp } from '@/store/app'
import { ResourcesPanel } from './ResourcesPanel'
import { NetworkPanel } from './NetworkPanel'
import { EditorPanel } from './EditorPanel'
import { ScriptsPanel } from './ScriptsPanel'
import { OverridesPanel } from './OverridesPanel'
import { BusPanel } from './BusPanel'
import { WorkspacesPanel } from './WorkspacesPanel'
import { WatchPanel } from './WatchPanel'
import { MapPanel } from './MapPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const PANELS = [
  { value: 'resources', label: 'Recursos', Component: ResourcesPanel },
  { value: 'network', label: 'Rede', Component: NetworkPanel },
  { value: 'editor', label: 'Editor', Component: EditorPanel },
  { value: 'scripts', label: 'Scripts', Component: ScriptsPanel },
  { value: 'overrides', label: 'Overrides', Component: OverridesPanel },
  { value: 'map', label: 'Mapa', Component: MapPanel },
  { value: 'watch', label: 'Observar', Component: WatchPanel },
  { value: 'bus', label: 'Bus', Component: BusPanel },
  { value: 'workspaces', label: 'Sessões', Component: WorkspacesPanel }
]

export function DevPanel() {
  const panelTab = useApp((s) => s.panelTab)
  const setPanelTab = useApp((s) => s.setPanelTab)

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <Tabs value={panelTab} onValueChange={setPanelTab} className="flex h-full min-h-0 flex-col gap-0">
        <TabsList className="h-9 w-full shrink-0 justify-start gap-0.5 rounded-none border-b border-border bg-transparent p-1">
          {PANELS.map((p) => (
            <TabsTrigger
              key={p.value}
              value={p.value}
              className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-secondary"
            >
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {PANELS.map((p) => (
          <TabsContent key={p.value} value={p.value} className="m-0 min-h-0 flex-1">
            <ErrorBoundary label={p.label}>
              <p.Component />
            </ErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
