import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Download, FolderPlus, GitBranch, Info, SquarePen, X } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { useStore } from '@/store/app-store'
import { shortcutLabel } from '@/lib/shortcuts'
import { RelayLogo } from './RelayLogo'
import { Button, Kbd, cn } from './ui'

export function StatusBar({ workspace }: { workspace: Workspace | undefined }): ReactNode {
  const status = useStore((s) => (workspace ? s.gitStatus[workspace.id] : undefined))
  const paneRuntime = useStore((s) => s.paneRuntime)
  const setRightTab = useStore((s) => s.updateUi)
  const working = Object.values(paneRuntime).filter((p) => p.status === 'working').length
  const waiting = Object.values(paneRuntime).filter((p) => p.status === 'permission').length

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-2xs text-muted-foreground">
      {workspace && !workspace.isFolder ? (
        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setRightTab({ rightSidebarOpen: true, rightSidebarTab: 'changes' })}>
          <GitBranch className="size-3" />
          <span className="font-mono">{status?.branch ?? workspace.branch ?? 'detached'}</span>
          {status?.ahead ? (
            <span className="flex items-center">
              <ArrowUp className="size-3" />
              {status.ahead}
            </span>
          ) : null}
          {status?.behind ? (
            <span className="flex items-center">
              <ArrowDown className="size-3" />
              {status.behind}
            </span>
          ) : null}
          {status?.files.length ? <span className="text-git-modified">· {status.files.length} changed</span> : null}
        </button>
      ) : null}
      <div className="flex-1" />
      {waiting ? <span className="text-agent-question">{waiting} waiting for input</span> : null}
      {working ? <span className="text-agent-working">{working} agent{working === 1 ? '' : 's'} working</span> : null}
      {workspace ? <span className="truncate font-mono">{workspace.path}</span> : null}
    </footer>
  )
}

export function Toaster(): ReactNode {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-4 bottom-9 z-[70] flex w-[360px] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-popover p-3 text-xs shadow-floating">
          {toast.kind === 'error' ? (
            <CircleAlert className="size-4 shrink-0 text-destructive" />
          ) : toast.kind === 'success' ? (
            <CircleCheck className="size-4 shrink-0 text-status-success" />
          ) : (
            <Info className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 break-words">{toast.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function UpdatePrompt(): ReactNode {
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.updatePromptDismissed)
  const setDismissed = useStore((s) => s.setUpdatePromptDismissed)
  if (update.state !== 'ready' || dismissed) {
    return null
  }
  return (
    <div role="alertdialog" aria-label="Update ready" className="fixed bottom-9 left-4 z-[70] flex w-[340px] flex-col gap-3 rounded-lg border border-border bg-popover p-3 text-xs shadow-floating">
      <div className="flex items-start gap-2">
        <Download className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Relay {update.version} is ready</p>
          <p className="mt-0.5 text-muted-foreground">Restart to finish installing the update.</p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Skip
        </Button>
        <Button size="sm" onClick={() => void window.relay.updater.install()}>
          Restart
        </Button>
      </div>
    </div>
  )
}

export function Landing(): ReactNode {
  const projects = useStore((s) => s.projects)
  const setDialog = useStore((s) => s.setDialog)
  const setPalette = useStore((s) => s.setPalette)
  const shortcuts = [
    { label: 'New workspace', keys: shortcutLabel('newWorkspace') },
    { label: 'Jump to workspace', keys: shortcutLabel('jumpWorkspace') },
    { label: 'Go to file', keys: shortcutLabel('quickOpen') },
    { label: 'Split terminal', keys: shortcutLabel('splitRight') },
    { label: 'Settings', keys: shortcutLabel('settings') }
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <RelayLogo className="size-12" />
        <h1 className="text-2xl font-semibold tracking-tight">Relay</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Run Claude Code, Codex, Gemini and any other CLI agent side by side — each in its own git worktree, tracked in one place.
        </p>
      </div>
      <div className="flex gap-2">
        {projects.length ? (
          <Button onClick={() => setDialog({ kind: 'composer' })}>
            <SquarePen className="size-4" /> New workspace
          </Button>
        ) : null}
        <Button variant={projects.length ? 'outline' : 'default'} onClick={() => setDialog({ kind: 'add-project' })}>
          <FolderPlus className="size-4" /> Add project
        </Button>
        {projects.length ? (
          <Button variant="outline" onClick={() => setPalette('workspaces')}>
            Jump to…
          </Button>
        ) : null}
      </div>
      <div className={cn('grid grid-cols-[auto_auto] gap-x-8 gap-y-2 text-xs text-muted-foreground')}>
        {shortcuts.map((s) => (
          <div key={s.label} className="contents">
            <span>{s.label}</span>
            <span className="text-right">
              <Kbd>{s.keys}</Kbd>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
