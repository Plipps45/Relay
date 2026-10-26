import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderPlus, GitBranch, RefreshCw, Shuffle, SquareTerminal } from 'lucide-react'
import { AGENTS } from '@shared/agents'
import type { BranchRef } from '@shared/types'
import { normalizeWorkspaceName } from '@shared/workspace-names'
import { errorMessage, useStore } from '@/store/app-store'
import { launchAgent, runScriptInNewTab } from '@/lib/launch-agent'
import { isMac } from '@/lib/shortcuts'
import { AgentMonogram } from './badges'
import { Button, Dialog, IconButton, Input, Kbd, Label, Spinner, cn } from './ui'

const TERMINAL_ONLY = '__terminal__'

export function ComposerDialog({ initialProjectId, initialPrompt }: { initialProjectId?: string; initialPrompt?: string }): ReactNode {
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const agents = useStore((s) => s.agents)
  const settings = useStore((s) => s.settings)
  const activeWorkspaceId = useStore((s) => s.ui?.activeWorkspaceId)
  const setDialog = useStore((s) => s.setDialog)
  const refreshWorkspaces = useStore((s) => s.refreshWorkspaces)
  const refreshAgents = useStore((s) => s.refreshAgents)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const openTerminalTab = useStore((s) => s.openTerminalTab)
  const toast = useStore((s) => s.toast)

  const gitProjects = projects.filter((p) => p.isGit)
  const activeProjectId = workspaces.find((w) => w.id === activeWorkspaceId)?.projectId
  const [projectId, setProjectId] = useState(
    initialProjectId ?? (gitProjects.some((p) => p.id === activeProjectId) ? activeProjectId : gitProjects[0]?.id) ?? ''
  )
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [branches, setBranches] = useState<BranchRef[]>([])
  const [baseRef, setBaseRef] = useState<string>('')
  const installed = useMemo(() => AGENTS.filter((a) => agents.find((x) => x.id === a.id)?.installed), [agents])
  const [agentId, setAgentId] = useState<string>(() => {
    const preferred = settings?.defaultAgent
    if (preferred && agents.find((a) => a.id === preferred)?.installed) {
      return preferred
    }
    return installed[0]?.id ?? TERMINAL_ONLY
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = projects.find((p) => p.id === projectId)

  useEffect(() => {
    if (agentId === TERMINAL_ONLY && installed.length && !settings?.defaultAgent) {
      setAgentId(installed[0].id)
    }
  }, [installed, agentId, settings?.defaultAgent])

  useEffect(() => {
    if (!project) {
      return
    }
    let cancelled = false
    void window.relay.workspaces.suggestName(project.id).then((suggested) => {
      if (!cancelled && !nameTouched) {
        setName(suggested)
      }
    })
    void Promise.all([window.relay.git.branches(project.path), window.relay.git.defaultBase(project.path)]).then(([refs, base]) => {
      if (!cancelled) {
        setBranches(refs)
        setBaseRef(base ?? refs.find((r) => r.current)?.name ?? '')
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const create = async (): Promise<void> => {
    if (!project || creating) {
      return
    }
    setCreating(true)
    setError(null)
    try {
      const result = await window.relay.workspaces.create({
        projectId: project.id,
        name: name.trim(),
        baseRef: baseRef || null,
        prompt,
        agentId: agentId === TERMINAL_ONLY ? null : agentId
      })
      await refreshWorkspaces()
      const workspaceId = result.workspace.id
      // Open tabs before selecting so selection does not add a default terminal.
      if (result.setupScript) {
        await runScriptInNewTab(workspaceId, 'Setup', result.setupScript)
      }
      if (agentId !== TERMINAL_ONLY) {
        await launchAgent(workspaceId, agentId, prompt)
      } else if (!result.setupScript) {
        openTerminalTab(workspaceId)
      }
      selectWorkspace(workspaceId)
      setDialog(null)
      toast('success', `Created ${result.workspace.displayName} on ${result.workspace.branch ?? 'a new branch'}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const close = (): void => setDialog(null)

  if (!gitProjects.length) {
    return (
      <Dialog title="New workspace" onClose={close} width={460}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">Workspaces are git worktrees. Add a git repository first.</p>
          <Button onClick={() => setDialog({ kind: 'add-project' })}>
            <FolderPlus className="size-4" /> Add project
          </Button>
        </div>
      </Dialog>
    )
  }

  const localBranches = branches.filter((b) => !b.remote)
  const remoteBranches = branches.filter((b) => b.remote)
  const normalized = normalizeWorkspaceName(name)

  return (
    <Dialog
      title="New workspace"
      description="Creates a git worktree on a fresh branch and starts the agent inside it."
      onClose={close}
      width={600}
      footer={
        <>
          {error ? <p className="mr-auto max-w-[340px] text-xs text-destructive">{error}</p> : null}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!project || !normalized || creating}>
            {creating ? <Spinner className="size-3.5" /> : null}
            Create workspace
            <span className="ml-1 text-2xs opacity-70">{isMac ? '⌘↵' : 'Ctrl+↵'}</span>
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void create()
          }
        }}
      >
        <div>
          <Label hint="Optional — sent to the agent as its first message">Prompt</Label>
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="What should the agent work on?"
            className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>

        <div>
          <Label hint={installed.length ? undefined : 'No agent CLIs detected on PATH'}>
            <span className="inline-flex items-center gap-2">
              Agent
              <IconButton label="Rescan PATH for agents" className="size-5" onClick={() => void refreshAgents(true)}>
                <RefreshCw className="size-3" />
              </IconButton>
            </span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {installed.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setAgentId(agent.id)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs',
                  agentId === agent.id ? 'border-ring bg-accent' : 'border-border hover:bg-accent/60'
                )}
              >
                <AgentMonogram agentId={agent.id} size={16} />
                {agent.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAgentId(TERMINAL_ONLY)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs',
                agentId === TERMINAL_ONLY ? 'border-ring bg-accent' : 'border-border hover:bg-accent/60'
              )}
            >
              <SquareTerminal className="size-4 text-muted-foreground" />
              Terminal only
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Project</Label>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                setNameTouched(false)
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
            >
              {gitProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" /> Start from
              </span>
            </Label>
            <select
              value={baseRef}
              onChange={(e) => setBaseRef(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:border-ring"
            >
              {baseRef && !branches.some((b) => b.name === baseRef) ? <option value={baseRef}>{baseRef}</option> : null}
              <optgroup label="Local branches">
                {localBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? ' (current)' : ''}
                  </option>
                ))}
              </optgroup>
              {remoteBranches.length ? (
                <optgroup label="Remote branches">
                  {remoteBranches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        </div>

        <div>
          <Label hint={normalized ? `Folder ${normalized}` : undefined}>Workspace name</Label>
          <div className="flex gap-1.5">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
              aria-invalid={name.length > 0 && !normalized}
            />
            <IconButton
              label="Suggest another name"
              className="size-8 border border-input"
              onClick={() => project && void window.relay.workspaces.suggestName(project.id).then((n) => {
                setName(n)
                setNameTouched(false)
              })}
            >
              <Shuffle className="size-3.5" />
            </IconButton>
          </div>
        </div>
        <p className="text-2xs text-muted-foreground">
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> + <Kbd>Enter</Kbd> creates the workspace. Settings → Workspaces controls the folder and branch prefix.
        </p>
      </div>
    </Dialog>
  )
}
