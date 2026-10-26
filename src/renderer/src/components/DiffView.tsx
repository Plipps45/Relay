import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { Columns2, MessageSquarePlus, RefreshCw, Rows2, Send, Trash2, X } from 'lucide-react'
import type { DiffComment } from '@shared/types'
import { useStore } from '@/store/app-store'
import { formatReviewComments, sendToAgent } from '@/lib/agent-delivery'
import { newId } from '@/lib/split-layout'
import { languageForPath, monaco } from '@/lib/monaco'
import { useIsDark } from '@/lib/theme'
import type { DiffMode } from '../../../preload/api-types'
import { Button, IconButton, Spinner, cn } from './ui'

type Composer = { line: number; side: 'original' | 'modified'; top: number; left: number }

export function joinPath(root: string, relative: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative.replace(/[\\/]/g, separator)}`
}

export function DiffView({ workspaceId, filePath, staged }: { workspaceId: string; filePath: string; staged: boolean }): ReactNode {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === workspaceId))
  const fileStatus = useStore((s) => s.gitStatus[workspaceId]?.files.find((f) => f.path === filePath))
  const updateWorkspaceMeta = useStore((s) => s.updateWorkspaceMeta)
  const settings = useStore((s) => s.settings)
  const isDark = useIsDark()
  const [contents, setContents] = useState<{ original: string; modified: string } | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const [composer, setComposer] = useState<Composer | null>(null)
  const [draft, setDraft] = useState('')
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const decorationsRef = useRef<{ original: string[]; modified: string[] }>({ original: [], modified: [] })
  const hoverDecorationRef = useRef<{ editor: monaco.editor.ICodeEditor; ids: string[] } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mode: DiffMode = staged ? 'staged' : fileStatus?.untracked ? 'untracked' : 'unstaged'
  const comments = useMemo(() => (workspace?.comments ?? []).filter((c) => c.filePath === filePath), [workspace?.comments, filePath])
  const allComments = workspace?.comments ?? []

  const load = useCallback(async () => {
    if (!workspace) {
      return
    }
    setContents(await window.relay.git.diffContents(workspace.path, filePath, fileStatus?.oldPath, mode))
  }, [workspace, filePath, fileStatus?.oldPath, mode])

  useEffect(() => {
    void load()
  }, [load])

  const setComments = (next: DiffComment[]): void => {
    void updateWorkspaceMeta(workspaceId, { comments: next })
  }

  // Paint saved comments as gutter dots plus a tinted line.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    for (const side of ['original', 'modified'] as const) {
      const target = side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor()
      decorationsRef.current[side] = target.deltaDecorations(
        decorationsRef.current[side],
        comments
          .filter((c) => c.side === side)
          .map((c) => ({
            range: new monaco.Range(c.line, 1, c.line, 1),
            options: { isWholeLine: true, className: 'diff-comment-line', glyphMarginClassName: 'diff-comment-glyph', glyphMarginHoverMessage: { value: c.text } }
          }))
      )
    }
  }, [comments, contents])

  const onMount: DiffOnMount = (editor) => {
    editorRef.current = editor
    const bind = (target: monaco.editor.ICodeEditor, side: 'original' | 'modified'): void => {
      target.onMouseMove((event) => {
        const line = event.target.position?.lineNumber
        const gutter =
          event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
        const previous = hoverDecorationRef.current
        if (previous && (previous.editor !== target || !gutter)) {
          previous.ids = previous.editor.deltaDecorations(previous.ids, [])
        }
        if (gutter && line) {
          const ids = hoverDecorationRef.current?.editor === target ? hoverDecorationRef.current.ids : []
          hoverDecorationRef.current = {
            editor: target,
            ids: target.deltaDecorations(ids, [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'diff-add-comment-glyph' } }])
          }
        }
      })
      target.onMouseDown((event) => {
        const line = event.target.position?.lineNumber
        if (
          !line ||
          (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
            event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS)
        ) {
          return
        }
        const container = containerRef.current?.getBoundingClientRect()
        const dom = target.getDomNode()?.getBoundingClientRect()
        if (!container || !dom) {
          return
        }
        const top = target.getTopForLineNumber(line) - target.getScrollTop() + (dom.top - container.top) + 20
        setComposer({ line, side, top: Math.min(top, container.height - 150), left: dom.left - container.left + 40 })
        setDraft('')
      })
    }
    bind(editor.getOriginalEditor(), 'original')
    bind(editor.getModifiedEditor(), 'modified')

    const modified = editor.getModifiedEditor()
    modified.onDidChangeModelContent(() => {
      if (mode === 'staged' || !workspace) {
        return
      }
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
      saveTimer.current = setTimeout(() => {
        void window.relay.fs.writeFile(joinPath(workspace.path, filePath), modified.getValue())
      }, 800)
    })
  }

  const addComment = (): void => {
    if (!composer || !draft.trim()) {
      return
    }
    setComments([
      ...allComments,
      { id: newId('comment'), filePath, line: composer.line, side: composer.side, text: draft.trim(), createdAt: Date.now() }
    ])
    setComposer(null)
    setDraft('')
  }

  const reveal = (comment: DiffComment): void => {
    const editor = editorRef.current
    const target = comment.side === 'original' ? editor?.getOriginalEditor() : editor?.getModifiedEditor()
    target?.revealLineInCenter(comment.line)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {fileStatus?.oldPath ? `${fileStatus.oldPath} → ` : ''}
          {filePath}
          <span className="ml-2 rounded bg-muted px-1 font-sans text-3xs uppercase">{mode === 'staged' ? 'Staged' : mode === 'untracked' ? 'Untracked' : 'Working tree'}</span>
        </span>
        <span className="hidden text-2xs text-muted-foreground md:inline">Click a line number to comment</span>
        <IconButton label={sideBySide ? 'Inline view' : 'Side-by-side view'} className="size-6" onClick={() => setSideBySide((v) => !v)}>
          {sideBySide ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
        </IconButton>
        <IconButton label="Refresh" className="size-6" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
        </IconButton>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {contents ? (
          <DiffEditor
            original={contents.original}
            modified={contents.modified}
            language={languageForPath(filePath)}
            originalModelPath={`diff-original://${workspaceId}/${filePath}?${mode}`}
            modifiedModelPath={`diff-modified://${workspaceId}/${filePath}?${mode}`}
            theme={isDark ? 'relay-dark' : 'relay-light'}
            onMount={onMount}
            options={{
              renderSideBySide: sideBySide,
              readOnly: mode === 'staged',
              originalEditable: false,
              glyphMargin: true,
              fontSize: settings?.editorFontSize ?? 13,
              fontFamily: settings?.terminalFontFamily,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
              renderOverviewRuler: false
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {composer ? (
          <div className="absolute z-20 w-[380px] rounded-lg border border-border bg-popover p-2 shadow-floating" style={{ top: Math.max(8, composer.top), left: Math.max(8, composer.left) }}>
            <div className="mb-1.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
              <MessageSquarePlus className="size-3.5" />
              Comment on line {composer.line}
              {composer.side === 'original' ? ' (removed)' : ''}
              <div className="flex-1" />
              <button type="button" aria-label="Cancel" onClick={() => setComposer(null)} className="hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </div>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  addComment()
                } else if (e.key === 'Escape') {
                  setComposer(null)
                }
              }}
              rows={3}
              placeholder="What should the agent change here?"
              className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus:border-ring"
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setComposer(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={addComment} disabled={!draft.trim()}>
                Add comment
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {allComments.length ? (
        <div className="max-h-48 shrink-0 border-t border-border">
          <div className="flex h-8 items-center gap-2 px-3">
            <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">Review comments ({allComments.length})</span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setComments([])}>
              Clear all
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (sendToAgent(workspaceId, formatReviewComments(allComments))) {
                  setComments([])
                }
              }}
            >
              <Send className="size-3.5" /> Send to agent
            </Button>
          </div>
          <ul className="scrollbar-sleek max-h-36 overflow-y-auto px-2 pb-2">
            {allComments.map((comment) => (
              <li
                key={comment.id}
                className={cn('group flex items-start gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent', comment.filePath !== filePath && 'opacity-70')}
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => comment.filePath === filePath && reveal(comment)}>
                  <span className="font-mono text-2xs text-muted-foreground">
                    {comment.filePath}:{comment.line}
                  </span>
                  <span className="ml-2">{comment.text}</span>
                </button>
                <button
                  type="button"
                  aria-label="Delete comment"
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  onClick={() => setComments(allComments.filter((c) => c.id !== comment.id))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
