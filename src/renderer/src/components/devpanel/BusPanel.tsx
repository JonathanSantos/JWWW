import { useState } from 'react'
import { Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'

function tryParse(raw: string): unknown {
  const t = raw.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

export function BusPanel() {
  const busLog = useApp((s) => s.busLog)
  const [topic, setTopic] = useState('')
  const [data, setData] = useState('')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1.5 border-b border-border p-2">
        <p className="text-[11px] text-muted-foreground">
          Nas páginas: <code className="font-mono text-violet-400">jwww.bus.emit(topico, dados)</code> ·{' '}
          <code className="font-mono text-violet-400">jwww.bus.on(topico | '*', cb)</code> — atravessa abas e
          domínios via IPC.
        </p>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!topic.trim()) return
            window.api.bus.emit(topic.trim(), tryParse(data))
          }}
        >
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="tópico"
            spellCheck={false}
            className="h-7 w-32 select-text rounded-md bg-secondary/60 px-2 font-mono text-[11px] outline-none focus:bg-secondary"
          />
          <input
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder='dados (JSON ou texto): {"a": 1}'
            spellCheck={false}
            className="h-7 min-w-0 flex-1 select-text rounded-md bg-secondary/60 px-2 font-mono text-[11px] outline-none focus:bg-secondary"
          />
          <Button type="submit" size="sm" variant="secondary" className="h-7 px-2">
            <Send className="h-3 w-3" />
          </Button>
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {busLog.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">Nenhuma mensagem no bus ainda.</p>
        )}
        {[...busLog].reverse().map((m, i) => (
          <div key={`${m.at}-${i}`} className="mb-1 rounded-md bg-secondary/40 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="h-4 border-violet-500/50 px-1.5 font-mono text-[9px] text-violet-400">
                {m.topic}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {m.from.origin}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
                {new Date(m.at).toLocaleTimeString()}
              </span>
            </div>
            <pre className="mt-1 max-h-24 select-text overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-foreground/90">
              {typeof m.data === 'string' ? m.data : JSON.stringify(m.data, null, 1)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}
