import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Braces, Eye, GitCompare, Globe2, RotateCw, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useApp, type EditorFile } from '@/store/app'
import { monaco } from '@/lib/monaco-setup'
import { sha256Hex } from '@/lib/hash'
import { contentTypeFromLanguage, fileLabel, hostOf } from '@/lib/lang'
import { applyPrettyEdits, canPrettify, makeAnchor, mapRange } from '@/lib/prettify'
import { DiffView, type DiffMode } from './DiffView'
import { overrideMatches, suggestPattern } from '@shared/glob'
import { describeForHumans, describeRange } from '@shared/analyze'
import type { OverrideEntry } from '@shared/schemas'

const GLOBAL_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

type PendingExpose = { selection: string; prefix: string; suffix: string }
type PendingWatch = PendingExpose & { descricao: string; sugestao: string }

/**
 * Traduz a seleção do editor para o espaço do arquivo original (quando a visão
 * formatada está ligada) e devolve a âncora textual com contexto.
 */
function ancoraDaSelecao(
  file: EditorFile,
  model: import('monaco-editor').editor.ITextModel,
  sel: import('monaco-editor').Selection
): { selection: string; prefix: string; suffix: string; base: string; start: number; end: number } | null {
  let start = model.getOffsetAt(sel.getStartPosition())
  let end = model.getOffsetAt(sel.getEndPosition())
  let full = model.getValue()

  if (file.pretty) {
    const mapped = mapRange(file.pretty.anchor, start, end)
    if (!mapped) return null
    ;[start, end] = mapped
    full = file.pretty.anchor.base
  }

  return {
    selection: full.slice(start, end),
    prefix: full.slice(Math.max(0, start - 80), start),
    suffix: full.slice(end, end + 80),
    base: full,
    start,
    end
  }
}

export function EditorPanel() {
  const files = useApp((s) => s.files)
  const activeFileUrl = useApp((s) => s.activeFileUrl)
  const overrides = useApp((s) => s.overrides)
  const statuses = useApp((s) => s.statuses)
  const closeFile = useApp((s) => s.closeFile)
  const setActiveFile = useApp((s) => s.setActiveFile)
  const updateFileText = useApp((s) => s.updateFileText)
  const markFileSaved = useApp((s) => s.markFileSaved)
  const setFilePretty = useApp((s) => s.setFilePretty)
  const commitFileText = useApp((s) => s.commitFileText)

  const file = files.find((f) => f.url === activeFileUrl)

  /**
   * Fonte da verdade para as ações: uma ref atualizada no render pode estar
   * atrasada em relação ao que o Monaco acabou de escrever no store, e aí
   * salvar gravaria o texto anterior à última digitação.
   */
  const currentFile = (): EditorFile | undefined => {
    const s = useApp.getState()
    return s.files.find((f) => f.url === s.activeFileUrl)
  }
  // Sem mapeamento confiável, formatar vira só leitura: editar aqui produziria
  // um override que não dá para reaplicar sobre o arquivo do servidor.
  const readOnly = Boolean(file?.pretty && !file.pretty.anchor.map)

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const [exposeOpen, setExposeOpen] = useState(false)
  const [exposeName, setExposeName] = useState('')
  const [pendingExpose, setPendingExpose] = useState<PendingExpose | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode | null>(null)
  const [watchOpen, setWatchOpen] = useState(false)
  const [watchLabel, setWatchLabel] = useState('')
  const [watchStack, setWatchStack] = useState(false)
  const [pendingWatch, setPendingWatch] = useState<PendingWatch | null>(null)

  const editOverride = file
    ? overrides.find((o) => o.kind === 'edit' && overrideMatches(o, file.url))
    : undefined
  const exposeOverrides = file
    ? overrides.filter((o) => o.kind === 'expose' && overrideMatches(o, file.url))
    : []
  const lastStatus = editOverride
    ? [...statuses].reverse().find((st) => st.overrideId === editOverride.id)
    : undefined

  const saveRef = useRef<() => void>(() => {})

  /**
   * Texto no espaço do arquivo original. Em modo formatado, reaplica as edições
   * do texto formatado sobre o original — assim o que vai para o servidor
   * mantém a formatação original e o override continua resiliente.
   */
  function resolveText(f: EditorFile): string | null {
    if (!f.pretty) return f.text
    return applyPrettyEdits(f.pretty.anchor, f.pretty.prettyText)
  }

  async function save() {
    const f = currentFile()
    if (!f) return
    const text = resolveText(f)
    if (text === null) {
      toast.error('Não foi possível mapear as edições de volta', {
        description: 'Desligue a formatação para editar este arquivo com segurança.'
      })
      return
    }
    commitFileText(f.url, text)

    const all = useApp.getState().overrides
    const existing = all.find((o) => o.kind === 'edit' && overrideMatches(o, f.url))
    const entry: OverrideEntry = existing
      ? { ...existing, editedText: text, updatedAt: Date.now() }
      : {
          id: crypto.randomUUID(),
          url: f.url,
          kind: 'edit',
          enabled: true,
          contentType: contentTypeFromLanguage(f.language),
          originalHash: await sha256Hex(f.originalText),
          originalText: f.originalText,
          editedText: text,
          updatedAt: Date.now()
        }
    await window.api.overrides.save(entry)
    markFileSaved(f.url)

    // Bundles com hash no nome (`app.a3f9b1.js`) quebram o override no próximo
    // deploy; oferecemos o glob equivalente em vez de deixar o dev descobrir.
    const suggestion = existing?.pattern ? null : suggestPattern(f.url)
    if (suggestion) {
      toast.success('Override salvo', {
        description: `O nome do arquivo parece ter hash de build. Casar por "${suggestion}" faria ele sobreviver a deploys.`,
        action: {
          label: 'Usar padrão',
          onClick: () => {
            window.api.overrides.save({ ...entry, pattern: suggestion })
            toast.success('Override agora casa por padrão', { description: suggestion })
          }
        }
      })
      return
    }
    toast.success('Override salvo', { description: 'Recarregue a página (⌘R) para aplicar.' })
  }
  saveRef.current = save

  function togglePretty() {
    const f = currentFile()
    if (!f) return
    if (f.pretty) {
      const text = resolveText(f)
      if (text === null) {
        toast.error('Edições não puderam ser mapeadas de volta ao arquivo original.')
        return
      }
      commitFileText(f.url, text)
      setFilePretty(f.url, undefined)
      return
    }
    const anchor = makeAnchor(f.text, f.language)
    if (!anchor.map) {
      toast.warning('Formatação disponível só para leitura', {
        description: 'Não foi possível mapear posições com segurança neste arquivo; edições ficam bloqueadas.'
      })
    }
    setFilePretty(f.url, { anchor, prettyText: anchor.prettyBase })
  }

  function openExposeDialog() {
    const ed = editorRef.current
    const f = currentFile()
    if (!ed || !f) return
    const model = ed.getModel()
    const sel = ed.getSelection()
    if (!model || !sel || sel.isEmpty()) {
      toast.info('Selecione um trecho de JS no editor primeiro.')
      return
    }
    if (f.dirty) {
      toast.warning('Salve o override antes de expor', {
        description: 'A âncora do trecho é gravada sobre o texto salvo — salve (⌘S) e tente de novo.'
      })
      return
    }

    // A âncora precisa casar com o arquivo que o servidor entrega, não com a
    // versão formatada: traduz a seleção de volta para o espaço original.
    const ancora = ancoraDaSelecao(f, model, sel)
    if (!ancora) {
      toast.error('Não é possível expor a partir da visão formatada neste arquivo', {
        description: 'Desligue a formatação e selecione o trecho novamente.'
      })
      return
    }
    if (!ancora.selection.trim()) {
      toast.info('Seleção vazia após o mapeamento — selecione o trecho de código em si.')
      return
    }

    setPendingExpose({
      selection: ancora.selection,
      prefix: ancora.prefix,
      suffix: ancora.suffix
    })
    setExposeName('')
    setExposeOpen(true)
  }

  function openWatchDialog() {
    const ed = editorRef.current
    const f = currentFile()
    if (!ed || !f) return
    const model = ed.getModel()
    const sel = ed.getSelection()
    if (!model || !sel || sel.isEmpty()) {
      toast.info('Selecione a função ou expressão que você quer observar.')
      return
    }
    if (f.dirty) {
      toast.warning('Salve o override antes de observar', {
        description: 'A âncora é gravada sobre o texto salvo — salve (⌘S) e tente de novo.'
      })
      return
    }

    const ancora = ancoraDaSelecao(f, model, sel)
    if (!ancora || !ancora.selection.trim()) {
      toast.error('Não foi possível mapear a seleção', {
        description: 'Desligue a formatação e selecione o trecho novamente.'
      })
      return
    }

    // O AST diz o que a seleção é no contexto do arquivo — é isso que decide se
    // dá para instrumentar e qual rótulo faz sentido oferecer.
    const info = describeRange(ancora.base, ancora.start, ancora.end)
    if (!info || (info.kind !== 'function' && info.kind !== 'expression')) {
      toast.error('Só dá para observar função ou expressão', {
        description: info
          ? `A seleção é ${describeForHumans(info)}.`
          : 'Não foi possível entender a estrutura deste trecho.'
      })
      return
    }

    setPendingWatch({
      selection: ancora.selection,
      prefix: ancora.prefix,
      suffix: ancora.suffix,
      descricao: describeForHumans(info),
      sugestao: info.name ?? (info.kind === 'function' ? 'anônima' : 'expressão')
    })
    setWatchLabel(info.name ?? '')
    setWatchStack(false)
    setWatchOpen(true)
  }

  async function confirmWatch() {
    const f = currentFile()
    if (!f || !pendingWatch) return
    const label = watchLabel.trim() || pendingWatch.sugestao
    const baseText = f.pretty ? f.pretty.anchor.base : f.text

    const entry: OverrideEntry = {
      id: crypto.randomUUID(),
      url: f.url,
      kind: 'watch',
      enabled: true,
      contentType: 'js',
      originalHash: await sha256Hex(baseText),
      originalText: '',
      watch: {
        label,
        selection: pendingWatch.selection,
        prefix: pendingWatch.prefix,
        suffix: pendingWatch.suffix,
        stack: watchStack
      },
      updatedAt: Date.now()
    }
    await window.api.overrides.save(entry)
    setWatchOpen(false)
    toast.success(`Observando "${label}"`, {
      description: 'Recarregue a página — cada execução aparece no painel Observar.'
    })
  }

  async function confirmExpose() {
    const f = currentFile()
    if (!f || !pendingExpose) return
    const baseText = f.pretty ? f.pretty.anchor.base : f.text
    if (!GLOBAL_NAME_RE.test(exposeName)) {
      toast.error('Nome inválido', { description: 'Use um identificador JS válido (ex: minhaVar).' })
      return
    }
    const entry: OverrideEntry = {
      id: crypto.randomUUID(),
      url: f.url,
      kind: 'expose',
      enabled: true,
      contentType: 'js',
      originalHash: await sha256Hex(baseText),
      originalText: '',
      expose: { name: exposeName, ...pendingExpose },
      updatedAt: Date.now()
    }
    await window.api.overrides.save(entry)
    setExposeOpen(false)
    toast.success(`globalThis.${exposeName} configurado`, {
      description: 'Recarregue a página — o trecho selecionado estará disponível no console.'
    })
  }

  // ⌘S salva dentro do Monaco
  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
    // Quando o editor monta com o painel ainda escondido (troca de aba, volta do
    // diff), ele mede 0 e trava em 5x5 — o automaticLayout não se recupera disso.
    requestAnimationFrame(() => editor.layout())
  }

  useEffect(() => {
    return () => {
      editorRef.current = null
    }
  }, [])

  // Abrir outro arquivo deve mostrar o código dele, não o diff do anterior.
  useEffect(() => {
    setDiffMode(null)
  }, [activeFileUrl])

  /**
   * O Monaco costuma montar aqui com o painel ainda escondido (troca de aba,
   * volta do diff): mede 0 e fica preso em 5x5 — o automaticLayout dele não se
   * recupera. Observamos o container e mandamos relayout quando ganha tamanho.
   */
  useEffect(() => {
    const host = editorHostRef.current
    if (!host) return
    const relayout = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) editorRef.current?.layout()
    }
    const ro = new ResizeObserver(relayout)
    ro.observe(host)
    relayout()
    return () => ro.disconnect()
  }, [diffMode])

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <p className="text-sm font-medium text-foreground/80">Nenhum arquivo aberto</p>
        <p>
          Clique em um arquivo no painel <span className="font-semibold">Recursos</span> ou{' '}
          <span className="font-semibold">Rede</span> para abrir aqui.
        </p>
        <p>Edite e salve (⌘S) para criar um override — aplicado como patch sobre o arquivo baixado a cada reload.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* abas de arquivos abertos */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-1.5 py-1">
        {files.map((f) => (
          <div
            key={f.url}
            onClick={() => setActiveFile(f.url)}
            title={f.url}
            className={cn(
              'group flex h-6 shrink-0 cursor-default items-center gap-1 rounded px-2 font-mono text-[11px]',
              f.url === file.url ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
            )}
          >
            {f.dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
            <span className="max-w-[140px] truncate">{fileLabel(f.url)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeFile(f.url)
              }}
              className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={file.url}>
          {hostOf(file.url)} · {fileLabel(file.url)}
        </span>
        {editOverride && (
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[9px]',
              !lastStatus && 'border-muted-foreground/40 text-muted-foreground',
              lastStatus?.status === 'applied' && 'border-emerald-500/50 text-emerald-400',
              lastStatus?.status === 'fuzzy' && 'border-amber-500/50 text-amber-400',
              lastStatus?.status === 'failed' && 'border-red-500/50 text-red-400'
            )}
            title={lastStatus?.message}
          >
            {!lastStatus && 'override salvo'}
            {lastStatus?.status === 'applied' && 'override aplicado'}
            {lastStatus?.status === 'fuzzy' && 'aplicado (fuzzy)'}
            {lastStatus?.status === 'failed' && 'falhou — site mudou'}
          </Badge>
        )}
        {exposeOverrides.map((o) => (
          <Badge key={o.id} variant="outline" className="h-4 border-violet-500/50 px-1.5 text-[9px] text-violet-400">
            {o.expose?.name}
          </Badge>
        ))}
        {file.pretty && (
          <Badge variant="outline" className="h-4 border-sky-500/50 px-1.5 text-[9px] text-sky-400">
            {file.pretty.anchor.map ? 'formatado' : 'formatado (leitura)'}
          </Badge>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-[11px]"
          onClick={save}
          disabled={(!file.dirty && !!editOverride) || readOnly}
        >
          <Save className="mr-1 h-3 w-3" /> Salvar
        </Button>
        {canPrettify(file.language) && (
          <Button
            size="sm"
            variant={file.pretty ? 'secondary' : 'ghost'}
            className="h-6 px-2 text-[11px]"
            onClick={togglePretty}
            title="Formatar código (não altera o arquivo servido)"
          >
            <Braces className="mr-1 h-3 w-3" /> Formatar
          </Button>
        )}
        <Button
          size="sm"
          variant={diffMode ? 'secondary' : 'ghost'}
          className="h-6 px-2 text-[11px]"
          onClick={() => setDiffMode(diffMode ? null : 'mine')}
          title="Comparar lado a lado"
        >
          <GitCompare className="mr-1 h-3 w-3" /> Diff
        </Button>
        {diffMode && (
          <select
            value={diffMode}
            onChange={(e) => setDiffMode(e.target.value as DiffMode)}
            className="h-6 rounded-md border-none bg-secondary/60 px-1.5 text-[11px] outline-none"
          >
            <option value="mine">original × suas mudanças</option>
            <option value="server">original × servidor agora</option>
          </select>
        )}
        {file.language === 'javascript' && (
          <>
            <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={openExposeDialog}>
              <Globe2 className="mr-1 h-3 w-3" /> Expor global
            </Button>
            <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={openWatchDialog}>
              <Eye className="mr-1 h-3 w-3" /> Observar
            </Button>
          </>
        )}
        {editOverride && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-red-400 hover:text-red-300"
            title="Remover override"
            onClick={async () => {
              await window.api.overrides.remove(editOverride.id)
              toast.success('Override removido')
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          title="Recarregar aba"
          onClick={() => {
            const tab = useApp.getState().tabs.find((t) => t.active)
            if (tab) window.api.tabs.reload(tab.id)
          }}
        >
          <RotateCw className="h-3 w-3" />
        </Button>
      </div>

      {/* editor / diff */}
      <div
        ref={editorHostRef}
        className="min-h-0 flex-1 select-text"
        /**
         * O TabsContent do Radix é focável (tabIndex=0) e fica com o foco do
         * clique, deixando o textarea escondido do Monaco de fora — resultado:
         * o cursor aparece mas a digitação não entra. O foco tem que ser
         * devolvido de forma síncrona: adiar para o próximo tick faz os
         * primeiros caracteres se perderem.
         */
        onMouseDown={(e) => {
          if (diffMode) return
          // O padrão do mousedown é focar o ancestral focável — o TabsContent —
          // logo depois de o Monaco focar o próprio textarea. Cancelamos esse
          // passo e reafirmamos o foco do editor.
          e.preventDefault()
          editorRef.current?.focus()
        }}
      >
        {diffMode ? (
          <DiffView
            file={file}
            mode={diffMode}
            currentText={resolveText(file) ?? file.text}
            pretty={Boolean(file.pretty)}
          />
        ) : (
        <Editor
          height="100%"
          path={file.pretty ? `${file.url}?pretty` : file.url}
          language={file.language}
          value={file.pretty ? file.pretty.prettyText : file.text}
          onChange={(v) => updateFileText(file.url, v ?? '')}
          onMount={onMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            wordWrap: 'off',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderWhitespace: 'none',
            contextmenu: true,
            readOnly
          }}
        />
        )}
      </div>

      {/* dialog de expor global */}
      <Dialog open={exposeOpen} onOpenChange={setExposeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Expor seleção como variável global</DialogTitle>
            <DialogDescription>
              No próximo reload, o arquivo será patchado para que este trecho fique disponível em{' '}
              <code className="font-mono text-violet-400">globalThis.&lt;nome&gt;</code>. Se o site mudar e a âncora
              não for encontrada, você será avisado e o original será servido.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-32 select-text overflow-auto rounded-md bg-secondary/60 p-2 font-mono text-[10px] leading-relaxed">
            {pendingExpose?.selection}
          </pre>
          <Input
            value={exposeName}
            onChange={(e) => setExposeName(e.target.value)}
            placeholder="nomeDaGlobal"
            spellCheck={false}
            className="select-text font-mono"
            onKeyDown={(e) => e.key === 'Enter' && confirmExpose()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExposeOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmExpose}>Expor</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog de observar execução */}
      <Dialog open={watchOpen} onOpenChange={setWatchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Observar execução</DialogTitle>
            <DialogDescription>
              Detectei <span className="font-semibold text-sky-400">{pendingWatch?.descricao}</span>. A cada
              execução, o painel <span className="font-semibold">Observar</span> registra argumentos, retorno e
              duração. O arquivo servido continua igual ao do servidor, com só este trecho instrumentado.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-32 select-text overflow-auto rounded-md bg-secondary/60 p-2 font-mono text-[10px] leading-relaxed">
            {pendingWatch?.selection}
          </pre>
          <Input
            value={watchLabel}
            onChange={(e) => setWatchLabel(e.target.value)}
            placeholder={pendingWatch?.sugestao ?? 'rótulo'}
            spellCheck={false}
            className="select-text font-mono"
            onKeyDown={(e) => e.key === 'Enter' && confirmWatch()}
            autoFocus
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={watchStack} onCheckedChange={setWatchStack} className="h-4 w-7" />
            Registrar quem chamou (stack) — mais pesado
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWatchOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmWatch}>Observar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
