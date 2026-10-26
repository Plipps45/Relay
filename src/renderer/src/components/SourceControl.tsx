import { useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ChevronRight, FileDiff, Minus, Plus, RefreshCw, Undo2 } from 'lucide-react'
import type { GitFileStatus, Workspace } from '@shared/types'
import { errorMessage, useStore } from '@/store/app-store'
import { GitStatusLetter } from './badges'
import { FileIcon } from './FileIcon'
import { Button, Dialog, IconButton, Spinner, cn } from './ui'

export function SourceControl({ workspace }: { workspace: Workspace }): ReactNode {
  const status = useStore((s) => s.gitStatus[workspace.id])
  const refreshGit = useStore((s) => s.refreshGit)
  const openDiffTab = useStore((s) => s.openDiffTab)
  const openChangesTab = useStore((s) => s.openChangesTab)
  const toast = useStore((s) => s.toast)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [confirmDiscard, setConfirmDiscard] = useState<GitFileStatus[] | null>(null)

  if (workspace.isFolder) {
    return <p className="p-4 text-xs text-muted-foreground">This project is a plain folder, not a git repository.</p>
  }

  const staged = status?.files.filter((f) => f.staged) ?? []
  const changes = status?.files.filter((f) => f.unstaged) ?? []

  const run = async (label: string, action: () => Promise<void>, success?: string): Promise<void> => {
    setBusy(label)
    try {
      await action()
      if (success) {
        toast('success', success)
      }
    } catch (error) {
      toast('error', errorMessage(error))
    } finally {
      setBusy(null)
      void refreshGit(workspace.id)
    }
  }

  const commit = (): void => {
    if (!message.trim()) {
      return
    }
    const all = staged.length === 0
    void run('commit', async () => {
      if (all) {
        const untracked = changes.filter((f) => f.untracked).map((f) => f.path)
        if (untracked.length) {
          await window.relay.git.stage(workspace.path, untracked)
        }
      }
      await window.relay.git.commit(workspace.path, message, all)
      setMessage('')
    }, 'Committed')
  }

  const discard = (files: GitFileStatus[]): void => {
    void run('discard', () =>
      window.relay.git.discard(
        workspace.path,
        files.filter((f) => !f.untracked).map((f) => f.path),
        files.filter((f) => f.untracked).map((f) => f.path)
      )
    )
  }

  const section = (id: 'staged' | 'changes', title: string, files: GitFileStatus[]): ReactNode => {
    if (!files.length) {
      return null
    }
    const isStaged = id === 'staged'
    return (
      <div className="mt-1">
        <div className="group/section flex h-7 items-center gap-1 px-2">
          <button type="button" className="flex flex-1 items-center gap-1 text-left" onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}>
            {collapsed[id] ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
            <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</span>
            <span className="rounded-full bg-muted px-1.5 text-3xs text-muted-foreground">{files.length}</span>
          </button>
          <div className="flex opacity-0 group-hover/section:opacity-100">
            {isStaged ? (
              <IconButton label="Unstage all" className="size-6" onClick={() => void run('unstage', () => window.relay.git.unstage(workspace.path, files.map((f) => f.path)))}>
                <Minus className="size-3.5" />
              </IconButton>
            ) : (
              <>
                <IconButton label="Discard all changes" className="size-6" onClick={() => setConfirmDiscard(files)}>
                  <Undo2 className="size-3.5" />
                </IconButton>
                <IconButton label="Stage all" className="size-6" onClick={() => void run('stage', () => window.relay.git.stage(workspace.path, files.map((f) => f.path)))}>
                  <Plus className="size-3.5" />
                </IconButton>
              </>
            )}
          </div>
        </div>
        {collapsed[id]
          ? null
          : files.map((file) => {
              const name = file.path.split('/').pop() ?? file.path
              const dir = file.path.slice(0, file.path.length - name.length).replace(/\/$/, '')
              const code = isStaged ? file.index : file.untracked ? '?' : file.worktree
              return (
                <div
                  key={`${id}:${file.path}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDiffTab(workspace.id, file.path, isStaged)}
                  className="group flex h-[22px] items-center gap-1.5 pr-1.5 pl-6 text-[13px] hover:bg-accent"
                >
                  <FileIcon name={name} />
                  <span className={cn('min-w-0 truncate', code === 'D' && 'line-through')}>{name}</span>
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{dir}</span>
                  <div className="hidden shrink-0 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                    {isStaged ? (
                      <IconButton label="Unstage" className="size-5" onClick={() => void run('unstage', () => window.relay.git.unstage(workspace.path, [file.path]))}>
                        <Minus className="size-3" />
                      </IconButton>
                    ) : (
                      <>
                        <IconButton label="Discard changes" className="size-5" onClick={() => setConfirmDiscard([file])}>
                          <Undo2 className="size-3" />
                        </IconButton>
                        <IconButton label="Stage" className="size-5" onClick={() => void run('stage', () => window.relay.git.stage(workspace.path, [file.path]))}>
                          <Plus className="size-3" />
                        </IconButton>
                      </>
                    )}
                  </div>
                  <GitStatusLetter code={code} />
                </div>
              )
            })}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {status?.branch ?? 'detached'}
          {status && (status.ahead || status.behind) ? (
            <span className="ml-1.5 text-2xs text-muted-foreground">
              {status.ahead ? `↑${status.ahead}` : ''} {status.behind ? `↓${status.behind}` : ''}
            </span>
          ) : null}
        </span>
        <IconButton label="All changes" className="size-6" onClick={() => openChangesTab(workspace.id)}>
          <FileDiff className="size-3.5" />
        </IconButton>
        <IconButton label="Pull (fast-forward)" className="size-6" disabled={busy !== null} onClick={() => void run('pull', () => window.relay.git.pull(workspace.path), 'Pulled')}>
          <ArrowDownToLine className="size-3.5" />
        </IconButton>
        <IconButton label="Push to origin" className="size-6" disabled={busy !== null} onClick={() => void run('push', () => window.relay.git.push(workspace.path), 'Pushed')}>
          <ArrowUpFromLine className="size-3.5" />
        </IconButton>
        <IconButton label="Refresh" className="size-6" onClick={() => void refreshGit(workspace.id)}>
          <RefreshCw className="size-3.5" />
        </IconButton>
      </div>
      <div className="px-2 pb-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              commit()
            }
          }}
          rows={3}
          placeholder={`Message (${navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'}Enter to commit)`}
          className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus:border-ring"
        />
        <Button className="mt-1.5 w-full" size="sm" disabled={!message.trim() || busy !== null || (!staged.length && !changes.length)} onClick={commit}>
          {busy === 'commit' ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />}
          {staged.length ? `Commit ${staged.length} staged` : 'Commit all'}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-3">
        {section('staged', 'Staged changes', staged)}
        {section('changes', 'Changes', changes)}
        {!staged.length && !changes.length ? <p className="px-4 py-3 text-xs text-muted-foreground">No changes.</p> : null}
      </div>
      {confirmDiscard ? (
        <Dialog
          title={confirmDiscard.length === 1 ? `Discard changes to ${confirmDiscard[0].path}?` : `Discard ${confirmDiscard.length} files?`}
          description="Tracked files return to their staged or committed version. Untracked files move to the Recycle Bin."
          onClose={() => setConfirmDiscard(null)}
          width={440}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDiscard(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  discard(confirmDiscard)
                  setConfirmDiscard(null)
                }}
              >
                Discard
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  )
}
