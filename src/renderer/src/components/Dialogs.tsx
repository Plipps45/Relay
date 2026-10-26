import { useEffect, useState, type ReactNode } from 'react'
import { FolderGit2, FolderOpen, Link2, TriangleAlert } from 'lucide-react'
import { errorMessage, useStore } from '@/store/app-store'
import { disposeTerminal } from '@/lib/terminal-registry'
import { Button, Dialog, Input, Label, Spinner } from './ui'

export function AddProjectDialog(): ReactNode {
  const setDialog = useStore((s) => s.setDialog)
  const refreshWorkspaces = useStore((s) => s.refreshWorkspaces)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const toast = useStore((s) => s.toast)
  const [cloneUrl, setCloneUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = async (projectPath: string): Promise<void> => {
    await refreshWorkspaces()
    const main = useStore.getState().workspaces.find((w) => w.path.toLowerCase() === projectPath.toLowerCase())
    if (main) {
      selectWorkspace(main.id)
    }
    setDialog(null)
  }

  const openFolder = async (): Promise<void> => {
    const path = await window.relay.dialog.pickFolder('Open a repository or folder')
    if (!path) {
      return
    }
    setBusy(true)
    try {
      const project = await window.relay.projects.add(path)
      if (!project.isGit) {
        toast('info', `${project.name} is not a git repository — it opens as a folder workspace.`)
      }
      await finish(project.path)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const clone = async (): Promise<void> => {
    if (!cloneUrl.trim()) {
      return
    }
    const parent = await window.relay.dialog.pickFolder('Choose where to clone')
    if (!parent) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const project = await window.relay.projects.clone(cloneUrl.trim(), parent)
      toast('success', `Cloned ${project.name}`)
      await finish(project.path)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Add project" description="Relay tracks git repositories and creates a worktree per workspace." onClose={() => setDialog(null)} width={500}>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void openFolder()}
          className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-accent disabled:opacity-50"
        >
          <span className="flex size-9 items-center justify-center rounded-md bg-muted">
            <FolderOpen className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-medium">Open local folder</span>
            <span className="block text-xs text-muted-foreground">A git repository, or any folder as a single workspace</span>
          </span>
        </button>
        <div>
          <Label>
            <span className="inline-flex items-center gap-1.5">
              <Link2 className="size-3.5" /> Clone from URL
            </span>
          </Label>
          <div className="flex gap-2">
            <Input
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              onKeyDown={(e) => e.key === 'Enter' && void clone()}
            />
            <Button variant="secondary" disabled={!cloneUrl.trim() || busy} onClick={() => void clone()}>
              {busy ? <Spinner className="size-3.5" /> : <FolderGit2 className="size-3.5" />}
              Clone
            </Button>
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  )
}

export function DeleteWorkspaceDialog({ workspaceId }: { workspaceId: string }): ReactNode {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === workspaceId))
  const settings = useStore((s) => s.settings)
  const session = useStore((s) => s.sessions[workspaceId])
  const setDialog = useStore((s) => s.setDialog)
  const refreshWorkspaces = useStore((s) => s.refreshWorkspaces)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const activeId = useStore((s) => s.ui?.activeWorkspaceId)
  const toast = useStore((s) => s.toast)
  const [deleteBranch, setDeleteBranch] = useState(settings?.deleteBranchWithWorkspace ?? false)
  const [dirtyCount, setDirtyCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workspace) {
      void window.relay.git
        .status(workspace.path)
        .then((status) => setDirtyCount(status.files.length))
        .catch(() => setDirtyCount(0))
    }
  }, [workspace])

  if (!workspace) {
    return null
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      for (const tab of session?.tabs ?? []) {
        if (tab.kind === 'terminal') {
          tab.panes.forEach((pane) => disposeTerminal(pane.id))
        }
      }
      window.relay.fs.unwatch(workspace.id)
      // Why: Windows refuses to delete a folder a shell still has open as its cwd.
      await new Promise((resolve) => setTimeout(resolve, 400))
      await window.relay.workspaces.remove({ workspaceId: workspace.id, deleteBranch, force: (dirtyCount ?? 0) > 0 })
      if (activeId === workspace.id) {
        selectWorkspace(null)
      }
      useStore.setState((state) => {
        const { [workspace.id]: _removed, ...sessions } = state.sessions
        return { sessions }
      })
      await refreshWorkspaces()
      setDialog(null)
      toast('success', `Deleted ${workspace.displayName}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Delete ${workspace.displayName}?`}
      description="Removes the worktree folder from disk. Open terminals in this workspace are closed."
      onClose={() => setDialog(null)}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || dirtyCount === null} onClick={() => void remove()}>
            {busy ? <Spinner className="size-3.5" /> : null}
            Delete workspace
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        <div className="rounded-md border border-border bg-muted/40 p-2.5 font-mono text-2xs">
          <div className="truncate">{workspace.path}</div>
          {workspace.branch ? <div className="mt-0.5 text-muted-foreground">branch {workspace.branch}</div> : null}
        </div>
        {dirtyCount ? (
          <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5">
            <TriangleAlert className="mt-px size-4 shrink-0 text-status-warning" />
            <span>
              {dirtyCount} uncommitted {dirtyCount === 1 ? 'change' : 'changes'} will be lost. Commit or push first to keep {dirtyCount === 1 ? 'it' : 'them'}.
            </span>
          </div>
        ) : null}
        {workspace.branch ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
            Also delete local branch <span className="font-mono">{workspace.branch}</span>
          </label>
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  )
}

export function RenameWorkspaceDialog({ workspaceId }: { workspaceId: string }): ReactNode {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === workspaceId))
  const updateWorkspaceMeta = useStore((s) => s.updateWorkspaceMeta)
  const setDialog = useStore((s) => s.setDialog)
  const [name, setName] = useState(workspace?.displayName ?? '')
  if (!workspace) {
    return null
  }
  const save = (): void => {
    if (name.trim()) {
      void updateWorkspaceMeta(workspace.id, { displayName: name.trim() })
    }
    setDialog(null)
  }
  return (
    <Dialog
      title="Rename workspace"
      description="Changes the name shown in Relay. The folder and branch stay the same."
      onClose={() => setDialog(null)}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            Rename
          </Button>
        </>
      }
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} onFocus={(e) => e.target.select()} />
    </Dialog>
  )
}

const PROJECT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#71717a']

export function ProjectSettingsDialog({ projectId }: { projectId: string }): ReactNode {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const setDialog = useStore((s) => s.setDialog)
  const refreshWorkspaces = useStore((s) => s.refreshWorkspaces)
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0])
  const [setupScript, setSetupScript] = useState(project?.setupScript ?? '')
  if (!project) {
    return null
  }
  const save = async (): Promise<void> => {
    await window.relay.projects.update(project.id, { name: name.trim() || project.name, color, setupScript })
    await refreshWorkspaces()
    setDialog(null)
  }
  return (
    <Dialog
      title={`${project.name} settings`}
      description={project.path}
      onClose={() => setDialog(null)}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label>Display name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Badge color</Label>
          <div className="flex gap-1.5">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className="size-6 rounded-md border-2"
                style={{ background: c, borderColor: color === c ? 'var(--foreground)' : 'transparent' }}
              />
            ))}
          </div>
        </div>
        <div>
          <Label hint="Runs in a Setup tab after each new workspace">Setup script</Label>
          <textarea
            value={setupScript}
            onChange={(e) => setSetupScript(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'npm install\nnpm run build'}
            className="w-full resize-none rounded-md border border-input bg-transparent p-2 font-mono text-xs outline-none focus:border-ring"
          />
          <p className="mt-1 text-2xs text-muted-foreground">
            Empty uses <span className="font-mono">scripts.setup</span> from <span className="font-mono">relay.yaml</span> in the repository.
          </p>
        </div>
      </div>
    </Dialog>
  )
}
