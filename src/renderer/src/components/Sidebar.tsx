import { useMemo, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Code2,
  Download,
  FolderOpen,
  FolderPlus,
  ListFilter,
  MailOpen,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X
} from 'lucide-react'
import type { Project, TabSession, Workspace } from '@shared/types'
import { useStore, workspaceAgentStatus, type Store } from '@/store/app-store'
import { focusTerminal } from '@/lib/terminal-registry'
import { shortcutLabel } from '@/lib/shortcuts'
import { AgentMonogram, AgentStateDot, ProjectBadge, WORKSPACE_STATUSES, WorkspaceStatusIcon, statusLabel } from './badges'
import { IconButton, cn, useMenu, type MenuItem } from './ui'
import { RelayLogo } from './RelayLogo'
import { UsageMeter } from './UsageMeter'

type Group = { id: string; label: ReactNode; icon?: ReactNode; workspaces: Workspace[]; project?: Project }

function sortByRecent(a: Workspace, b: Workspace): number {
  return Number(a.isMain) - Number(b.isMain) || b.lastActiveAt - a.lastActiveAt || a.displayName.localeCompare(b.displayName)
}

function agentPanes(tabs: TabSession[] | undefined): { tabId: string; paneId: string }[] {
  return (tabs ?? []).flatMap((tab) => (tab.kind === 'terminal' ? tab.panes.map((pane) => ({ tabId: tab.id, paneId: pane.id })) : []))
}

export function Sidebar(): ReactNode {
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const ui = useStore((s) => s.ui)
  const updateUi = useStore((s) => s.updateUi)
  const setDialog = useStore((s) => s.setDialog)
  const setPalette = useStore((s) => s.setPalette)
  const toggleLeftSidebar = useStore((s) => s.toggleLeftSidebar)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const menu = useMenu()
  const groupBy = ui?.groupBy ?? 'status'

  const groups = useMemo<Group[]>(() => {
    const query = filter.trim().toLowerCase()
    const visible = workspaces.filter((w) => {
      if (!query) {
        return true
      }
      const project = projects.find((p) => p.id === w.projectId)
      return [w.displayName, w.branch ?? '', project?.name ?? ''].some((text) => text.toLowerCase().includes(query))
    })
    const pinned = visible.filter((w) => w.pinned).sort(sortByRecent)
    const rest = visible.filter((w) => !w.pinned)
    const result: Group[] = []
    if (pinned.length) {
      result.push({ id: 'pinned', label: 'Pinned', icon: <Pin className="size-3.5" />, workspaces: pinned })
    }
    if (groupBy === 'project') {
      for (const project of projects) {
        result.push({
          id: `project:${project.id}`,
          label: project.name,
          project,
          icon: <span className="size-2.5 rounded-[3px]" style={{ background: project.color }} />,
          workspaces: rest.filter((w) => w.projectId === project.id).sort(sortByRecent)
        })
      }
    } else if (groupBy === 'status') {
      const order = ['in-progress', 'in-review', 'todo', 'completed'] as const
      for (const status of order) {
        const items = rest.filter((w) => w.status === status).sort(sortByRecent)
        if (items.length) {
          result.push({ id: `status:${status}`, label: statusLabel(status), icon: <WorkspaceStatusIcon status={status} />, workspaces: items })
        }
      }
    } else {
      result.push({ id: 'all', label: 'All workspaces', workspaces: rest.sort(sortByRecent) })
    }
    return result
  }, [workspaces, projects, filter, groupBy])

  const openGroupMenu = (element: HTMLElement): void => {
    menu.openBelow(
      [
        { kind: 'header', label: 'Group by' },
        { label: 'Status', checked: groupBy === 'status', onSelect: () => updateUi({ groupBy: 'status' }) },
        { label: 'Project', checked: groupBy === 'project', onSelect: () => updateUi({ groupBy: 'project' }) },
        { label: 'None', checked: groupBy === 'none', onSelect: () => updateUi({ groupBy: 'none' }) }
      ],
      element,
      'end'
    )
  }

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground" style={{ width: ui?.sidebarWidth ?? 280 }}>
      <div className="drag-region flex h-[38px] shrink-0 items-center gap-2 pl-3 pr-2">
        <RelayLogo className="size-4" />
        <span className="text-[13px] font-semibold">Relay</span>
        <div className="flex-1" />
        <IconButton label="Hide sidebar" onClick={toggleLeftSidebar}>
          <PanelLeftClose className="size-4" />
        </IconButton>
      </div>

      <nav className="flex flex-col gap-px px-2 pb-2">
        <NavItem icon={<SquarePen className="size-4" />} label="New workspace" hint={shortcutLabel('newWorkspace')} onClick={() => setDialog({ kind: 'composer' })} />
        <NavItem icon={<Search className="size-4" />} label="Jump to…" hint={shortcutLabel('jumpWorkspace')} onClick={() => setPalette('workspaces')} />
      </nav>

      <div className="flex h-8 shrink-0 items-center gap-1 pl-3 pr-2">
        <span className="flex-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">Workspaces</span>
        <IconButton label="Group by" onClick={(e) => openGroupMenu(e.currentTarget)}>
          <ListFilter className="size-3.5" />
        </IconButton>
        <IconButton label="Add project" onClick={() => setDialog({ kind: 'add-project' })}>
          <FolderPlus className="size-3.5" />
        </IconButton>
        <IconButton label="New workspace" onClick={() => setDialog({ kind: 'composer' })}>
          <Plus className="size-4" />
        </IconButton>
      </div>

      <div className="px-2 pb-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-sidebar-border bg-background/40 px-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter workspaces"
            className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {filter ? (
            <button type="button" aria-label="Clear filter" onClick={() => setFilter('')} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <div className="mx-1 mt-3 rounded-lg border border-dashed border-sidebar-border p-4 text-center">
            <p className="text-xs text-muted-foreground">Add a git repository to start creating workspaces.</p>
            <button
              type="button"
              onClick={() => setDialog({ kind: 'add-project' })}
              className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
            >
              <FolderPlus className="size-3.5" /> Add project
            </button>
          </div>
        ) : null}
        {groups.map((group) => {
          const isCollapsed = collapsed[group.id]
          return (
            <section key={group.id} className="mt-1">
              <div className="group/header flex h-7 items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent/60">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                >
                  {isCollapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                  {group.icon}
                  <span className="truncate text-[13px] font-semibold">{group.label}</span>
                  <span className="rounded-full bg-sidebar-accent px-1.5 text-3xs text-muted-foreground">{group.workspaces.length}</span>
                </button>
                {group.project ? (
                  <div className="flex opacity-0 group-hover/header:opacity-100">
                    <IconButton label="Project settings" className="size-6" onClick={() => setDialog({ kind: 'project-settings', projectId: group.project!.id })}>
                      <Settings className="size-3.5" />
                    </IconButton>
                    <IconButton label={`New workspace in ${group.project.name}`} className="size-6" onClick={() => setDialog({ kind: 'composer', projectId: group.project!.id })}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  </div>
                ) : null}
              </div>
              {isCollapsed ? null : (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {group.workspaces.map((workspace) => (
                    <WorkspaceRow key={workspace.id} workspace={workspace} onMenu={(items, x, y) => menu.openAt(items, { x, y })} />
                  ))}
                  {group.workspaces.length === 0 ? <p className="px-7 py-1 text-2xs text-muted-foreground">No workspaces</p> : null}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <UsageMeter />
      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-sidebar-border px-2">
        <button
          type="button"
          onClick={() => setDialog({ kind: 'add-project' })}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <FolderPlus className="size-3.5" /> Add project
        </button>
        <div className="flex-1" />
        <UpdateButton />
        <IconButton label={`Settings (${shortcutLabel('settings')})`} onClick={() => setDialog({ kind: 'settings' })}>
          <Settings className="size-4" />
        </IconButton>
      </div>
      {menu.render()}
    </aside>
  )
}

function UpdateButton(): ReactNode {
  const update = useStore((s) => s.update)
  const busy = update.state === 'checking' || update.state === 'downloading'
  const label =
    update.state === 'ready'
      ? `Restart to install Relay ${update.version}`
      : update.state === 'downloading'
        ? `Downloading Relay ${update.version}…`
        : update.state === 'checking'
          ? 'Checking for updates…'
          : 'Check for updates'

  const onClick = async (): Promise<void> => {
    const state = useStore.getState()
    if (update.state === 'ready') {
      state.setUpdatePromptDismissed(false)
      return
    }
    const result = await window.relay.updater.check()
    if (result.state === 'up-to-date') {
      state.toast('success', 'Relay is up to date.')
    } else if (result.state === 'available') {
      state.toast('info', `Relay ${result.version} is available. Updates install only in the packaged app.`)
    } else if (result.state === 'ready') {
      state.setUpdatePromptDismissed(false)
    } else if (result.state === 'error') {
      state.toast('error', `Update check failed: ${result.message}`)
    }
  }

  return (
    <IconButton label={label} disabled={busy} onClick={() => void onClick()} className="relative">
      {update.state === 'ready' ? <Download className="size-4" /> : <RefreshCw className={cn('size-4', busy && 'animate-spin')} />}
      {update.state === 'ready' ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-status-success" /> : null}
    </IconButton>
  )
}

function NavItem({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {hint ? <span className="text-2xs opacity-0 group-hover:opacity-100">{hint}</span> : null}
    </button>
  )
}

function workspaceMenu(workspace: Workspace, project: Project | undefined, state: Store): MenuItem[] {
  const items: MenuItem[] = [
    { label: 'Rename…', icon: <Pencil />, onSelect: () => state.setDialog({ kind: 'rename-workspace', workspaceId: workspace.id }) },
    {
      label: 'Status',
      icon: <WorkspaceStatusIcon status={workspace.status} />,
      submenu: WORKSPACE_STATUSES.map((status) => ({
        label: status.label,
        checked: workspace.status === status.id,
        onSelect: () => state.setWorkspaceStatus(workspace.id, status.id)
      }))
    },
    workspace.pinned
      ? { label: 'Unpin', icon: <PinOff />, onSelect: () => void state.updateWorkspaceMeta(workspace.id, { pinned: false }) }
      : { label: 'Pin', icon: <Pin />, onSelect: () => void state.updateWorkspaceMeta(workspace.id, { pinned: true }) },
    { label: 'Mark as unread', icon: <MailOpen />, onSelect: () => state.markUnread(workspace.id, true) },
    { kind: 'separator' },
    {
      label: 'Open in VS Code',
      icon: <Code2 />,
      onSelect: () =>
        void window.relay.shell.openInEditor(workspace.path).then((ok) => {
          if (!ok) {
            state.toast('error', 'VS Code (`code`) was not found on PATH.')
          }
        })
    },
    { label: 'Reveal in File Explorer', icon: <FolderOpen />, onSelect: () => void window.relay.shell.openPath(workspace.path) },
    { label: 'Copy path', icon: <Copy />, onSelect: () => void navigator.clipboard.writeText(workspace.path) },
    ...(workspace.branch
      ? [{ label: 'Copy branch name', icon: <Copy />, onSelect: () => void navigator.clipboard.writeText(workspace.branch ?? '') } as MenuItem]
      : [])
  ]
  items.push({ kind: 'separator' })
  if (workspace.isMain || workspace.isFolder) {
    if (project) {
      items.push({
        label: 'Remove project from Relay',
        icon: <Trash2 />,
        danger: true,
        onSelect: () =>
          void window.relay.projects.remove(project.id).then(() => {
            if (state.ui?.activeWorkspaceId && state.workspaces.find((w) => w.id === state.ui?.activeWorkspaceId)?.projectId === project.id) {
              state.selectWorkspace(null)
            }
            void useStore.getState().refreshWorkspaces()
          })
      })
    }
  } else {
    items.push({ label: 'Delete workspace…', icon: <Trash2 />, danger: true, onSelect: () => state.setDialog({ kind: 'delete-workspace', workspaceId: workspace.id }) })
  }
  return items
}

function WorkspaceRow({ workspace, onMenu }: { workspace: Workspace; onMenu: (items: MenuItem[], x: number, y: number) => void }): ReactNode {
  const active = useStore((s) => s.ui?.activeWorkspaceId === workspace.id)
  const project = useStore((s) => s.projects.find((p) => p.id === workspace.projectId))
  const unread = useStore((s) => Boolean(s.unread[workspace.id]))
  const agentStatus = useStore((s) => workspaceAgentStatus(s, workspace.id))
  const tabs = useStore((s) => s.sessions[workspace.id]?.tabs)
  const paneRuntime = useStore((s) => s.paneRuntime)
  const changes = useStore((s) => s.gitStatus[workspace.id]?.files.length ?? 0)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const setActivePane = useStore((s) => s.setActivePane)

  const agents = agentPanes(tabs)
    .map((entry) => ({ ...entry, runtime: paneRuntime[entry.paneId] }))
    .filter((entry) => entry.runtime?.agentId && !entry.runtime.exited)

  return (
    <div
      role="button"
      tabIndex={0}
      data-current={active}
      onClick={() => selectWorkspace(workspace.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          selectWorkspace(workspace.id)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(workspaceMenu(workspace, project, useStore.getState()), e.clientX, e.clientY)
      }}
      className={cn(
        'group flex flex-col gap-1 rounded-lg px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex w-3.5 shrink-0 justify-center">
          {agentStatus === 'working' || agentStatus === 'permission' || unread ? (
            <AgentStateDot status={agentStatus} unread={unread} />
          ) : (
            <WorkspaceStatusIcon status={workspace.status} className="size-3" />
          )}
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold' : 'font-medium')}>{workspace.displayName}</span>
        {workspace.isFolder ? (
          <span className="rounded border border-sidebar-border px-1 text-3xs text-muted-foreground">Folder</span>
        ) : workspace.isMain ? (
          <span className="rounded border border-sidebar-border px-1 text-3xs text-muted-foreground">primary</span>
        ) : null}
        {workspace.pinned ? <Pin className="size-3 text-muted-foreground" /> : null}
        {changes > 0 ? <span className="font-mono text-3xs text-git-modified">{changes}</span> : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 pl-5">
        {project ? <ProjectBadge name={project.name} color={project.color} /> : null}
        <span className="truncate font-mono text-2xs text-muted-foreground">{workspace.branch ?? (workspace.isFolder ? workspace.path : 'detached')}</span>
      </div>
      {agents.length ? (
        <div className="ml-5 flex flex-wrap items-center gap-1 rounded-md border border-sidebar-border bg-background/40 px-1.5 py-1">
          {agents.map((agent) => (
            <button
              key={agent.paneId}
              type="button"
              title={agent.runtime?.title}
              onClick={(e) => {
                e.stopPropagation()
                selectWorkspace(workspace.id)
                setActiveTab(workspace.id, agent.tabId)
                setActivePane(agent.tabId, agent.paneId)
                setTimeout(() => focusTerminal(agent.paneId), 50)
              }}
              className="flex items-center gap-1 rounded px-0.5 hover:bg-sidebar-accent"
            >
              <AgentMonogram agentId={agent.runtime?.agentId} size={15} />
              <AgentStateDot status={agent.runtime?.status ?? null} className="size-2.5" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
