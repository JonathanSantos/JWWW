import { useEffect, useRef } from 'react'
import { useApp } from '@/store/app'

/**
 * A página real é um WebContentsView desenhado PELO MAIN PROCESS por cima
 * da janela. Este componente só reserva o retângulo e reporta os bounds.
 */
export function PageViewport() {
  const ref = useRef<HTMLDivElement>(null)
  const hasTabs = useApp((s) => s.tabs.length > 0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const send = () => {
      const r = el.getBoundingClientRect()
      window.api.tabs.setViewport({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(send)
    })
    ro.observe(el)
    window.addEventListener('resize', send)
    send()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={ref} className="relative h-full w-full bg-background">
      {!hasTabs && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="font-mono text-2xl font-semibold tracking-tight text-foreground/80">JWWW</div>
          <p className="text-sm">⌘T para abrir uma nova aba</p>
        </div>
      )}
    </div>
  )
}
