import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Code2, Copy, FileWarning, FolderOpen } from 'lucide-react'
import { useStore } from '@/store/app-store'
import { languageForPath, monaco } from '@/lib/monaco'
import { useIsDark } from '@/lib/theme'
import type { FileContent } from '../../../preload/api-types'
import { IconButton, Spinner } from './ui'

function relativePath(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, '') : path
}

export function EditorTab({ workspaceId, filePath, visible }: { workspaceId: string; filePath: string; visible: boolean }): ReactNode {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === workspaceId))
  const settings = useStore((s) => s.settings)
  const pendingReveal = useStore((s) => s.pendingReveal)
  const clearPendingReveal = useStore((s) => s.clearPendingReveal)
  const toast = useStore((s) => s.toast)
  const isDark = useIsDark()
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const savedRef = useRef<string>('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await window.relay.fs.readFile(filePath)
      setContent(result)
      if (result.kind === 'text') {
        savedRef.current = result.content
        const model = monaco.editor.getModel(monaco.Uri.file(filePath))
        if (model && model.getValue() !== result.content) {
          model.setValue(result.content)
        }
        setDirty(false)
      }
      setError(null)
    } catch (err) {
      setError(String(err))
    }
  }, [filePath])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    const value = editorRef.current?.getValue()
    if (value === undefined || value === savedRef.current) {
      return
    }
    try {
      await window.relay.fs.writeFile(filePath, value)
      savedRef.current = value
      setDirty(false)
    } catch (err) {
      toast('error', `Could not save ${filePath}: ${String(err)}`)
    }
  }, [filePath, toast])

  // Reload when the agent edits the file on disk and there are no local edits.
  useEffect(() => {
    return window.relay.fs.onChanged((changedWorkspace, paths) => {
      if (changedWorkspace !== workspaceId || !workspace) {
        return
      }
      const rel = relativePath(workspace.path, filePath).toLowerCase()
      if (paths.some((p) => p.toLowerCase() === rel) && !dirty) {
        void load()
      }
    })
  }, [workspaceId, workspace, filePath, dirty, load])

  useEffect(() => {
    if (pendingReveal && pendingReveal.path === filePath && editorRef.current) {
      const editor = editorRef.current
      editor.revealLineInCenter(pendingReveal.line)
      editor.setPosition({ lineNumber: pendingReveal.line, column: 1 })
      editor.focus()
      clearPendingReveal()
    }
  }, [pendingReveal, filePath, clearPendingReveal, content])

  useEffect(() => {
    if (visible) {
      editorRef.current?.layout()
    }
  }, [visible])

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
    if (pendingReveal && pendingReveal.path === filePath) {
      editor.revealLineInCenter(pendingReveal.line)
      editor.setPosition({ lineNumber: pendingReveal.line, column: 1 })
      clearPendingReveal()
    }
  }

  const rel = workspace ? relativePath(workspace.path, filePath) : filePath

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {rel}
          {dirty ? <span className="ml-1.5 text-foreground">●</span> : null}
        </span>
        <IconButton label="Copy path" className="size-6" onClick={() => void navigator.clipboard.writeText(filePath)}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="Reveal in File Explorer" className="size-6" onClick={() => void window.relay.shell.showItem(filePath)}>
          <FolderOpen className="size-3.5" />
        </IconButton>
        <IconButton label="Open in VS Code" className="size-6" onClick={() => void window.relay.shell.openInEditor(filePath)}>
          <Code2 className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <Centered icon={<FileWarning className="size-5" />} text={error} />
        ) : !content ? (
          <Centered icon={<Spinner />} text="Loading" />
        ) : content.kind === 'image' ? (
          <div className="scrollbar-sleek flex h-full items-center justify-center overflow-auto p-6" style={{ backgroundImage: 'repeating-conic-gradient(var(--muted) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}>
            <img src={content.dataUrl} alt={rel} className="max-h-full max-w-full object-contain" />
          </div>
        ) : content.kind === 'binary' ? (
          <Centered icon={<FileWarning className="size-5" />} text="Binary file — not shown." />
        ) : content.kind === 'too-large' ? (
          <Centered icon={<FileWarning className="size-5" />} text={`File is ${(content.size / 1024 / 1024).toFixed(1)} MB — too large to open here.`} />
        ) : (
          <Editor
            path={monaco.Uri.file(filePath).toString()}
            defaultValue={content.content}
            defaultLanguage={languageForPath(filePath)}
            theme={isDark ? 'relay-dark' : 'relay-light'}
            onMount={onMount}
            onChange={(value) => {
              const changed = value !== savedRef.current
              setDirty(changed)
              if (changed && settings?.editorAutoSave) {
                if (saveTimer.current) {
                  clearTimeout(saveTimer.current)
                }
                saveTimer.current = setTimeout(() => void save(), 800)
              }
            }}
            options={{
              fontSize: settings?.editorFontSize ?? 13,
              fontFamily: settings?.terminalFontFamily,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              renderWhitespace: 'selection',
              automaticLayout: true,
              padding: { top: 8 }
            }}
          />
        )}
      </div>
    </div>
  )
}

function Centered({ icon, text }: { icon: ReactNode; text: string }): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      {icon}
      <span className="max-w-md text-center">{text}</span>
    </div>
  )
}
