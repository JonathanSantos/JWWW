import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { monaco } from '@/lib/monaco-setup'
import { canPrettify, prettify } from '@/lib/prettify'
import type { EditorFile } from '@/store/app'

/** Diff de bundle minificado cabe numa linha só e não se lê. */
function looksMinified(text: string): boolean {
  const firstBreak = text.indexOf('\n')
  return (firstBreak === -1 ? text.length : firstBreak) > 500
}

export type DiffMode = 'mine' | 'server'

type Props = {
  file: EditorFile
  mode: DiffMode
  /** texto atual no espaço do arquivo original (já remapeado se estiver formatado) */
  currentText: string
  pretty: boolean
}

/**
 * 'mine'   — o que você mudou: snapshot do servidor × sua edição.
 * 'server' — o que o site mudou: seu snapshot × o corpo que o servidor entrega
 *            agora. É a resposta para "o override aplicou com fuzzy, e daí?".
 *
 * Os models são criados e destruídos à mão porque o wrapper do React descarta
 * os TextModel antes de soltar o widget, o que dispara um erro não capturado
 * do Monaco e derruba a UI inteira ao fechar o diff.
 */
export function DiffView({ file, mode, currentText, pretty }: Props) {
  const [serverText, setServerText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(
    null
  )

  useEffect(() => {
    if (mode !== 'server') {
      setServerText(null)
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.net
      .getBody(file.tabId, '', file.url)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.text !== undefined) setServerText(res.text)
        else toast.error('Não foi possível buscar o arquivo do servidor', { description: res.error })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, file.url, file.tabId])

  useEffect(() => {
    if (!hostRef.current) return
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      theme: 'vs-dark',
      readOnly: true,
      // Inline: o painel dev é estreito e duas colunas deixariam ~290px para
      // cada lado, o que não serve para ler código.
      renderSideBySide: false,
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderOverviewRuler: false
    })
    editorRef.current = editor
    return () => {
      // Solta os models do widget antes de destruir qualquer um deles.
      editor.setModel(null)
      editor.dispose()
      modelsRef.current?.original.dispose()
      modelsRef.current?.modified.dispose()
      modelsRef.current = null
      editorRef.current = null
    }
  }, [])

  const ready = mode === 'mine' || serverText !== null
  const rightText = mode === 'mine' ? currentText : (serverText ?? '')

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !ready) return
    // Como o diff é só leitura, formatar aqui não afeta o que é servido.
    const format =
      canPrettify(file.language) && (pretty || looksMinified(file.originalText) || looksMinified(rightText))
    const fmt = (t: string) => (format ? prettify(t, file.language) : t)
    const next = {
      original: monaco.editor.createModel(fmt(file.originalText), file.language),
      modified: monaco.editor.createModel(fmt(rightText), file.language)
    }
    editor.setModel(next)
    const previous = modelsRef.current
    modelsRef.current = next
    previous?.original.dispose()
    previous?.modified.dispose()
  }, [ready, rightText, file.originalText, file.language, pretty])

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-background text-xs text-muted-foreground">
          {loading ? 'Buscando a versão atual do servidor…' : 'Sem resposta do servidor.'}
        </div>
      )}
    </div>
  )
}
