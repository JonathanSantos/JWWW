import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode; label: string }
type State = { error: Error | null }

/**
 * Um erro em um painel não pode derrubar a janela inteira — junto com ela iriam
 * os arquivos abertos e o estado do editor.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[jwww] erro em ${this.props.label}:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-red-400">O painel {this.props.label} falhou</p>
        <pre className="max-h-40 max-w-full select-text overflow-auto rounded-md bg-secondary/60 p-2 text-left font-mono text-[10px] text-muted-foreground">
          {error.message}
        </pre>
        <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
          Tentar de novo
        </Button>
      </div>
    )
  }
}
