import { useEffect, useState, type ReactNode } from 'react'
import { FileDiff } from 'lucide-react'
import { useStore } from '@/store/app-store'
import { GitStatusLetter } from './badges'
import { DiffView } from './DiffView'
import { cn } from './ui'

type Selection = { path: string; staged: boolean }

/** Every changed file in one place: a file list on the left, the selected diff on the right. */
export function ChangesTab({ workspaceId }: { workspaceId: string }): ReactNode {
  const status = useStore((s) => s.gitStatus[workspaceId])
  const refreshGit = useStore((s) => s.refreshGit)
  const [selected, setSelected] = useState<Selection | null>(null)

  useEffect(() => {
    void refreshGit(workspaceId)
  }, [workspaceId, refreshGit])

  const entries = (status?.files ?? []).flatMap((file) => {
    const rows: { path: string; staged: boolean; code: string }[] = []
    if (file.staged) {
      rows.push({ path: file.path, staged: true, code: file.index })
    }
    if (file.unstaged) {
      rows.push({ path: file.path, staged: false, code: file.untracked ? '?' : file.worktree })
    }
    return rows
  })

  useEffect(() => {
    if (!entries.length) {
      setSelected(null)
    } else if (!selected || !entries.some((e) => e.path === selected.path && e.staged === selected.staged)) {
      setSelected({ path: entries[0].path, staged: entries[0].staged })
    }
  }, [entries, selected])

  if (!entries.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <FileDiff className="size-5" />
        No changes in this workspace.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="scrollbar-sleek w-64 shrink-0 overflow-y-auto border-r border-border bg-card py-1">
        <div className="px-3 py-1.5 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">{entries.length} changed</div>
        {entries.map((entry) => {
          const name = entry.path.split('/').pop()
          const dir = entry.path.slice(0, entry.path.length - (name?.length ?? 0)).replace(/\/$/, '')
          const active = selected?.path === entry.path && selected.staged === entry.staged
          return (
            <button
              key={`${entry.staged ? 's' : 'w'}:${entry.path}`}
              type="button"
              onClick={() => setSelected({ path: entry.path, staged: entry.staged })}
              className={cn('flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent', active && 'bg-accent')}
            >
              <span className="min-w-0 flex-1 truncate">
                {name}
                {dir ? <span className="ml-1.5 text-2xs text-muted-foreground">{dir}</span> : null}
              </span>
              {entry.staged ? <span className="text-3xs text-muted-foreground">staged</span> : null}
              <GitStatusLetter code={entry.code} />
            </button>
          )
        })}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? <DiffView key={`${selected.path}:${selected.staged}`} workspaceId={workspaceId} filePath={selected.path} staged={selected.staged} /> : null}
      </div>
    </div>
  )
}
