import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FolderPlus, Globe, Search, Settings, SquarePen, SquareTerminal } from 'lucide-react'
import { useStore, workspaceAgentStatus } from '@/store/app-store'
import { joinPath } from './DiffView'
import { AgentStateDot, ProjectBadge, WorkspaceStatusIcon } from './badges'
import { FileIcon } from './FileIcon'
import { Spinner, cn } from './ui'

type Item = {
  id: string
  label: string
  detail?: string
  icon: ReactNode
  trailing?: ReactNode
  run: () => void
}

/** Subsequence match scored toward contiguous runs and basename hits, like VS Code's quick open. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) {
    return 0
  }
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let streak = 0
  for (const char of q) {
    const found = t.indexOf(char, ti)
    if (found === -1) {
      return null
    }
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 - Math.min(found - ti, 10) * 0.1
    ti = found + 1
  }
  const base = t.split('/').pop() ?? t
  if (base.includes(q)) {
    score += 10
  }
  return score - t.length * 0.01
}

const fileCache = new Map<string, { at: number; files: string[] }>()

export function QuickOpen({ mode }: { mode: 'files' | 'workspaces' }): ReactNode {
  const setPalette = useStore((s) => s.setPalette)
  const workspaces = useStore((s) => s.workspaces)
  const projects = useStore((s) => s.projects)
  const activeId = useStore((s) => s.ui?.activeWorkspaceId)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [files, setFiles] = useState<string[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const active = workspaces.find((w) => w.id === activeId)

  useEffect(() => {
    if (mode !== 'files' || !active) {
      return
    }
    const cached = fileCache.get(active.path)
    if (cached && Date.now() - cached.at < 15_000) {
      setFiles(cached.files)
      return
    }
    void window.relay.fs.listFiles(active.path).then((list) => {
      fileCache.set(active.path, { at: Date.now(), files: list })
      setFiles(list)
    })
  }, [mode, active])

  const close = (): void => setPalette(null)

  const items = useMemo<Item[]>(() => {
    const state = useStore.getState()
    if (mode === 'files') {
      if (!active || !files) {
        return []
      }
      return files
        .map((file) => ({ file, score: fuzzyScore(query, file) }))
        .filter((entry): entry is { file: string; score: number } => entry.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 80)
        .map(({ file }) => {
          const name = file.split('/').pop() ?? file
          return {
            id: file,
            label: name,
            detail: file.slice(0, file.length - name.length),
            icon: <FileIcon name={name} />,
            run: () => state.openEditorTab(active.id, joinPath(active.path, file))
          }
        })
    }
    const commands: Item[] = [
      { id: 'cmd:new', label: 'New workspace', icon: <SquarePen className="size-4" />, run: () => state.setDialog({ kind: 'composer' }) },
      { id: 'cmd:project', label: 'Add project', icon: <FolderPlus className="size-4" />, run: () => state.setDialog({ kind: 'add-project' }) },
      ...(active
        ? [
            { id: 'cmd:terminal', label: 'New terminal tab', icon: <SquareTerminal className="size-4" />, run: () => state.openTerminalTab(active.id) },
            { id: 'cmd:browser', label: 'New browser tab', icon: <Globe className="size-4" />, run: () => state.openBrowserTab(active.id) },
            { id: 'cmd:files', label: 'Go to file…', icon: <Search className="size-4" />, run: () => setTimeout(() => state.setPalette('files'), 0) }
          ]
        : []),
      { id: 'cmd:settings', label: 'Settings', icon: <Settings className="size-4" />, run: () => state.setDialog({ kind: 'settings' }) }
    ]
    const workspaceItems: Item[] = workspaces.map((w) => {
      const project = projects.find((p) => p.id === w.projectId)
      const status = workspaceAgentStatus(state, w.id)
      return {
        id: w.id,
        label: w.displayName,
        detail: w.branch ?? w.path,
        icon: status ? <AgentStateDot status={status} unread={state.unread[w.id]} /> : <WorkspaceStatusIcon status={w.status} />,
        trailing: project ? <ProjectBadge name={project.name} color={project.color} /> : null,
        run: () => state.selectWorkspace(w.id)
      }
    })
    const scored = [...workspaceItems, ...commands]
      .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.detail ?? ''}`) }))
      .filter((entry): entry is { item: Item; score: number } => entry.score !== null)
    if (query) {
      scored.sort((a, b) => b.score - a.score)
    } else {
      scored.sort((a, b) => {
        const wa = workspaces.find((w) => w.id === a.item.id)?.lastActiveAt ?? -1
        const wb = workspaces.find((w) => w.id === b.item.id)?.lastActiveAt ?? -1
        return wb - wa
      })
    }
    return scored.map((entry) => entry.item)
  }, [mode, query, files, active, workspaces, projects])

  useEffect(() => setSelected(0), [query, mode])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-[620px] overflow-hidden rounded-xl border border-border bg-popover shadow-floating">
        <div className="flex h-11 items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'files' ? (active ? `Go to file in ${active.displayName}` : 'Select a workspace first') : 'Jump to a workspace or run a command'}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const item = items[selected]
                if (item) {
                  close()
                  item.run()
                }
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
            className="h-full flex-1 bg-transparent text-sm outline-none"
          />
          {mode === 'files' && !files && active ? <Spinner className="size-3.5" /> : null}
        </div>
        <div ref={listRef} className="scrollbar-sleek max-h-[50vh] overflow-y-auto p-1">
          {items.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">{mode === 'files' && !files ? 'Indexing files…' : 'No results'}</p> : null}
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-selected={index === selected}
              onMouseMove={() => setSelected(index)}
              onClick={() => {
                close()
                item.run()
              }}
              className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px]', index === selected && 'bg-accent')}
            >
              <span className="flex size-4 items-center justify-center">{item.icon}</span>
              <span className="truncate">{item.label}</span>
              {item.detail ? <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">{item.detail}</span> : <span className="flex-1" />}
              {item.trailing}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
