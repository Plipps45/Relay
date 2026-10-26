import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Copy, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { DirEntry, Workspace } from '@shared/types'
import { errorMessage, useStore } from '@/store/app-store'
import { IconButton, cn, useMenu, type MenuItem } from './ui'
import { FileIcon } from './FileIcon'

type Pending = { parent: string; kind: 'file' | 'folder' } | { rename: string } | null

function separatorFor(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}

function relative(root: string, path: string): string {
  return path.slice(root.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
}

export function FileExplorer({ workspace }: { workspace: Workspace }): ReactNode {
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [workspace.path]: true })
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const status = useStore((s) => s.gitStatus[workspace.id])
  const openEditorTab = useStore((s) => s.openEditorTab)
  const toast = useStore((s) => s.toast)
  const menu = useMenu()

  const load = useCallback(async (dir: string) => {
    try {
      const entries = await window.relay.fs.readDir(dir)
      setChildren((c) => ({ ...c, [dir]: entries }))
    } catch {
      setChildren((c) => ({ ...c, [dir]: [] }))
    }
  }, [])

  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const reloadExpanded = useCallback(() => {
    for (const [dir, open] of Object.entries(expandedRef.current)) {
      if (open) {
        void load(dir)
      }
    }
  }, [load])

  useEffect(() => {
    setChildren({})
    setExpanded({ [workspace.path]: true })
    void load(workspace.path)
  }, [workspace.path, load])

  useEffect(() => {
    return window.relay.fs.onChanged((workspaceId) => {
      if (workspaceId === workspace.id) {
        reloadExpanded()
      }
    })
  }, [workspace.id, reloadExpanded])

  const statusFor = (path: string): string | null => {
    const rel = relative(workspace.path, path)
    const file = status?.files.find((f) => f.path === rel)
    if (file) {
      return file.untracked ? '?' : file.worktree !== '.' ? file.worktree : file.index
    }
    return status?.files.some((f) => f.path.startsWith(`${rel}/`)) ? 'dir' : null
  }

  const toggle = (dir: string): void => {
    const open = !expanded[dir]
    setExpanded((e) => ({ ...e, [dir]: open }))
    if (open && !children[dir]) {
      void load(dir)
    }
  }

  const commitPending = async (name: string): Promise<void> => {
    const current = pending
    setPending(null)
    if (!current || !name.trim()) {
      return
    }
    try {
      if ('rename' in current) {
        const parent = current.rename.slice(0, current.rename.length - (current.rename.split(/[\\/]/).pop()?.length ?? 0))
        await window.relay.fs.rename(current.rename, parent + name.trim())
      } else {
        const target = `${current.parent}${separatorFor(current.parent)}${name.trim()}`
        await window.relay.fs.create(target, current.kind === 'folder')
        setExpanded((e) => ({ ...e, [current.parent]: true }))
        if (current.kind === 'file') {
          openEditorTab(workspace.id, target)
        }
      }
      reloadExpanded()
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }

  const entryMenu = (entry: DirEntry | null): MenuItem[] => {
    const dir = entry ? (entry.isDirectory ? entry.path : entry.path.slice(0, entry.path.length - entry.name.length - 1)) : workspace.path
    const items: MenuItem[] = [
      { label: 'New file…', icon: <FilePlus />, onSelect: () => setPending({ parent: dir, kind: 'file' }) },
      { label: 'New folder…', icon: <FolderPlus />, onSelect: () => setPending({ parent: dir, kind: 'folder' }) }
    ]
    if (entry) {
      items.push(
        { kind: 'separator' },
        { label: 'Rename…', icon: <Pencil />, onSelect: () => setPending({ rename: entry.path }) },
        { label: 'Copy path', icon: <Copy />, onSelect: () => void navigator.clipboard.writeText(entry.path) },
        { label: 'Copy relative path', icon: <Copy />, onSelect: () => void navigator.clipboard.writeText(relative(workspace.path, entry.path)) },
        { label: 'Reveal in File Explorer', icon: <FolderOpen />, onSelect: () => void window.relay.shell.showItem(entry.path) },
        { kind: 'separator' },
        {
          label: 'Move to Recycle Bin',
          icon: <Trash2 />,
          danger: true,
          onSelect: () =>
            void window.relay.fs
              .trash(entry.path)
              .then(reloadExpanded)
              .catch((error) => toast('error', errorMessage(error)))
        }
      )
    }
    return items
  }

  const renderEntries = (dir: string, depth: number): ReactNode => {
    const entries = children[dir]
    const pendingHere = pending && 'parent' in pending && pending.parent === dir
    return (
      <>
        {pendingHere ? <PendingInput depth={depth} kind={pending.kind} onDone={(name) => void commitPending(name)} /> : null}
        {entries?.map((entry) => {
          const code = statusFor(entry.path)
          const isRenaming = pending && 'rename' in pending && pending.rename === entry.path
          return (
            <div key={entry.path}>
              {isRenaming ? (
                <PendingInput depth={depth} kind={entry.isDirectory ? 'folder' : 'file'} initial={entry.name} onDone={(name) => void commitPending(name)} />
              ) : (
                <div
                  role="treeitem"
                  data-file-explorer-row
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-relay-path', entry.path)
                    e.dataTransfer.setData('text/plain', entry.path)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => {
                    setSelected(entry.path)
                    if (entry.isDirectory) {
                      toggle(entry.path)
                    } else {
                      openEditorTab(workspace.id, entry.path)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelected(entry.path)
                    menu.openAt(entryMenu(entry), { x: e.clientX, y: e.clientY })
                  }}
                  className={cn('flex h-[22px] cursor-default items-center gap-1 pr-2 text-[13px] hover:bg-accent', selected === entry.path && 'bg-accent')}
                  style={{ paddingLeft: 8 + depth * 12 }}
                >
                  {entry.isDirectory ? (
                    expanded[entry.path] ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  {entry.isDirectory ? <Folder className="size-3.5 shrink-0 text-muted-foreground" /> : <FileIcon name={entry.name} />}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      code === '?' || code === 'A' ? 'text-git-untracked' : code === 'M' ? 'text-git-modified' : code === 'D' ? 'text-git-deleted line-through' : ''
                    )}
                  >
                    {entry.name}
                  </span>
                  {code && code !== 'dir' ? <span className="font-mono text-3xs text-muted-foreground">{code === '?' ? 'U' : code}</span> : null}
                  {code === 'dir' ? <span className="size-1.5 rounded-full bg-git-modified/70" /> : null}
                </div>
              )}
              {entry.isDirectory && expanded[entry.path] ? renderEntries(entry.path, depth + 1) : null}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{workspace.path.split(/[\\/]/).pop()}</span>
        <IconButton label="New file" className="size-6" onClick={() => setPending({ parent: workspace.path, kind: 'file' })}>
          <FilePlus className="size-3.5" />
        </IconButton>
        <IconButton label="New folder" className="size-6" onClick={() => setPending({ parent: workspace.path, kind: 'folder' })}>
          <FolderPlus className="size-3.5" />
        </IconButton>
        <IconButton label="Refresh" className="size-6" onClick={reloadExpanded}>
          <RefreshCw className="size-3.5" />
        </IconButton>
      </div>
      <div
        className="scrollbar-sleek min-h-0 flex-1 overflow-auto pb-4"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault()
            menu.openAt(entryMenu(null), { x: e.clientX, y: e.clientY })
          }
        }}
      >
        {renderEntries(workspace.path, 0)}
      </div>
      {menu.render()}
    </div>
  )
}

function PendingInput({ depth, kind, initial = '', onDone }: { depth: number; kind: 'file' | 'folder'; initial?: string; onDone: (name: string) => void }): ReactNode {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: 8 + depth * 12 + 14 }}>
      {kind === 'folder' ? <Folder className="size-3.5 text-muted-foreground" /> : <FileIcon name={value} />}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => {
          const dot = initial.lastIndexOf('.')
          e.target.setSelectionRange(0, dot > 0 ? dot : initial.length)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onDone(value)
          } else if (e.key === 'Escape') {
            onDone('')
          }
        }}
        onBlur={() => onDone(value === initial ? '' : value)}
        className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-[13px] outline-none"
      />
    </div>
  )
}
