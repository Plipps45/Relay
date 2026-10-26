import { useState, type ReactNode } from 'react'
import {
  Columns2,
  FileCode2,
  FileDiff,
  Files,
  Globe,
  NotebookText,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Rows2,
  SquareTerminal,
  X
} from 'lucide-react'
import { AGENTS } from '@shared/agents'
import type { TabSession, Workspace } from '@shared/types'
import { useStore, type Store } from '@/store/app-store'
import { launchAgent } from '@/lib/launch-agent'
import { shortcutLabel } from '@/lib/shortcuts'
import { AgentMonogram, AgentStateDot } from './badges'
import { BrowserTab } from './BrowserTab'
import { ChangesTab } from './ChangesTab'
import { DiffView } from './DiffView'
import { EditorTab } from './EditorTab'
import { NotesTab } from './NotesTab'
import { RelayLogo } from './RelayLogo'
import { TerminalTab } from './TerminalTab'
import { IconButton, cn, useMenu, type MenuItem } from './ui'

function tabStatus(state: Store, tab: TabSession) {
  if (tab.kind !== 'terminal') {
    return { status: null, agentId: null as string | null, title: tab.title }
  }
  let status: 'working' | 'permission' | 'idle' | null = null
  let agentId: string | null = null
  let title = tab.title
  for (const pane of tab.panes) {
    const runtime = state.paneRuntime[pane.id]
    if (!runtime) {
      continue
    }
    agentId ??= runtime.agentId
    if (runtime.status === 'permission' || (runtime.status === 'working' && status !== 'permission') || (runtime.status === 'idle' && status === null)) {
      status = runtime.status
    }
    if (tab.panes.length === 1 && runtime.title) {
      title = runtime.title
    }
  }
  return { status, agentId, title }
}

export function newTabMenuItems(workspaceId: string): MenuItem[] {
  const state = useStore.getState()
  const installed = new Set(state.agents.filter((a) => a.installed).map((a) => a.id))
  const available = AGENTS.filter((agent) => installed.has(agent.id))
  return [
    { label: 'New terminal', icon: <SquareTerminal />, shortcut: shortcutLabel('newTerminal'), onSelect: () => state.openTerminalTab(workspaceId) },
    { label: 'New browser tab', icon: <Globe />, shortcut: shortcutLabel('newBrowser'), onSelect: () => state.openBrowserTab(workspaceId) },
    { label: 'Notes (Obsidian vault)', icon: <NotebookText />, shortcut: shortcutLabel('notes'), onSelect: () => state.openNotesTab(workspaceId) },
    { label: 'All changes', icon: <FileDiff />, onSelect: () => state.openChangesTab(workspaceId) },
    { kind: 'separator' },
    { kind: 'header', label: available.length ? 'Start agent' : 'No agent CLIs found on PATH' },
    ...available.map(
      (agent): MenuItem => ({
        label: agent.label,
        icon: <AgentMonogram agentId={agent.id} size={14} />,
        onSelect: () => void launchAgent(workspaceId, agent.id)
      })
    ),
    ...(available.length ? [] : [{ label: 'Manage agents…', onSelect: () => state.setDialog({ kind: 'settings', section: 'agents' }) } as MenuItem])
  ]
}

function TabIcon({ tab, agentId }: { tab: TabSession; agentId: string | null }): ReactNode {
  if (tab.kind === 'terminal') {
    return agentId ? <AgentMonogram agentId={agentId} size={14} /> : <SquareTerminal className="size-3.5 text-muted-foreground" />
  }
  if (tab.kind === 'editor') {
    return <FileCode2 className="size-3.5 text-muted-foreground" />
  }
  if (tab.kind === 'diff') {
    return <FileDiff className="size-3.5 text-git-modified" />
  }
  if (tab.kind === 'changes') {
    return <Files className="size-3.5 text-muted-foreground" />
  }
  if (tab.kind === 'notes') {
    return <NotebookText className="size-3.5 text-muted-foreground" />
  }
  return <Globe className="size-3.5 text-muted-foreground" />
}

export function TabBar({ workspace, reserveControls }: { workspace: Workspace | undefined; reserveControls: boolean }): ReactNode {
  const state = useStore()
  const session = workspace ? state.sessions[workspace.id] : undefined
  const menu = useMenu()
  const [dragging, setDragging] = useState<string | null>(null)
  const rightOpen = state.ui?.rightSidebarOpen ?? true

  return (
    <div className={cn('drag-region flex h-[38px] shrink-0 items-stretch border-b border-border bg-background', reserveControls && 'titlebar-overlay-pad')}>
      {!state.leftSidebarOpen ? (
        <div className="flex items-center gap-1.5 pl-2 pr-1">
          <IconButton label="Show sidebar" onClick={state.toggleLeftSidebar}>
            <PanelLeftOpen className="size-4" />
          </IconButton>
          <RelayLogo className="size-4" />
        </div>
      ) : null}
      <div className="scrollbar-sleek flex min-w-0 items-stretch overflow-x-auto">
        {session?.tabs.map((tab) => {
          const info = tabStatus(state, tab)
          const active = session.activeTabId === tab.id
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={() => setDragging(tab.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (workspace && dragging && dragging !== tab.id) {
                  state.moveTab(workspace.id, dragging, tab.id)
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1 && workspace) {
                  e.preventDefault()
                  state.closeTab(workspace.id, tab.id)
                }
              }}
              onClick={() => workspace && state.setActiveTab(workspace.id, tab.id)}
              title={info.title}
              className={cn(
                'no-drag group relative flex max-w-[220px] min-w-[110px] shrink-0 items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-xs',
                active ? 'bg-card text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              {active ? <span className="absolute inset-x-0 top-0 h-px bg-foreground/60" /> : null}
              <TabIcon tab={tab} agentId={info.agentId} />
              <span className="min-w-0 flex-1 truncate">{info.title}</span>
              <span className="flex size-5 items-center justify-center">
                {info.status && info.status !== 'idle' ? (
                  <span className="group-hover:hidden">
                    <AgentStateDot status={info.status} className="size-2.5" />
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (workspace) {
                      state.closeTab(workspace.id, tab.id)
                    }
                  }}
                  className={cn(
                    'size-5 items-center justify-center rounded hover:bg-accent',
                    info.status && info.status !== 'idle' ? 'hidden group-hover:flex' : active ? 'flex' : 'hidden group-hover:flex'
                  )}
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )
        })}
      </div>
      {workspace ? (
        <div className="flex items-center px-1">
          <IconButton label="New tab" onClick={(e) => menu.openBelow(newTabMenuItems(workspace.id), e.currentTarget)}>
            <Plus className="size-4" />
          </IconButton>
        </div>
      ) : null}
      <div className="flex-1" />
      {workspace ? (
        <div className="flex items-center gap-0.5 px-2">
          <IconButton label={`Split right (${shortcutLabel('splitRight')})`} onClick={() => state.splitActivePane(workspace.id, 'row')}>
            <Columns2 className="size-3.5" />
          </IconButton>
          <IconButton label={`Split down (${shortcutLabel('splitDown')})`} onClick={() => state.splitActivePane(workspace.id, 'column')}>
            <Rows2 className="size-3.5" />
          </IconButton>
          {!rightOpen ? (
            <IconButton label="Show right sidebar" onClick={() => state.updateUi({ rightSidebarOpen: true })}>
              <PanelRightOpen className="size-4" />
            </IconButton>
          ) : (
            <IconButton label="Hide right sidebar" onClick={() => state.updateUi({ rightSidebarOpen: false })}>
              <PanelRightClose className="size-4" />
            </IconButton>
          )}
        </div>
      ) : null}
      {menu.render()}
    </div>
  )
}

export function WorkbenchContent({ workspace }: { workspace: Workspace }): ReactNode {
  const session = useStore((s) => s.sessions[workspace.id])
  if (!session || session.tabs.length === 0) {
    return <EmptyWorkspace workspace={workspace} />
  }
  return (
    <div className="relative h-full min-h-0">
      {session.tabs.map((tab) => {
        const visible = tab.id === session.activeTabId
        // Monaco's diff editor sets visibility: visible on its inner editors, which defeats `invisible`.
        const hideWithDisplay = tab.kind === 'diff' || tab.kind === 'changes'
        return (
          <div key={tab.id} className={cn('absolute inset-0', !visible && (hideWithDisplay ? 'hidden' : 'invisible'))} aria-hidden={!visible}>
            {tab.kind === 'terminal' ? (
              <TerminalTab workspaceId={workspace.id} tab={tab} visible={visible} />
            ) : tab.kind === 'editor' ? (
              <EditorTab workspaceId={workspace.id} filePath={tab.filePath} visible={visible} />
            ) : tab.kind === 'diff' ? (
              <DiffView workspaceId={workspace.id} filePath={tab.filePath} staged={tab.staged} />
            ) : tab.kind === 'changes' ? (
              <ChangesTab workspaceId={workspace.id} />
            ) : tab.kind === 'notes' ? (
              <NotesTab workspaceId={workspace.id} tab={tab} visible={visible} />
            ) : (
              <BrowserTab workspaceId={workspace.id} tabId={tab.id} url={tab.url} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function EmptyWorkspace({ workspace }: { workspace: Workspace }): ReactNode {
  const openTerminalTab = useStore((s) => s.openTerminalTab)
  const menu = useMenu()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>No tabs open in {workspace.displayName}.</p>
      <div className="flex gap-2">
        <button type="button" className="h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground" onClick={() => openTerminalTab(workspace.id)}>
          New terminal
        </button>
        <button
          type="button"
          className="h-8 rounded-md border border-border px-3 text-sm text-foreground hover:bg-accent"
          onClick={(e) => menu.openBelow(newTabMenuItems(workspace.id), e.currentTarget)}
        >
          Start agent…
        </button>
      </div>
      {menu.render()}
    </div>
  )
}
