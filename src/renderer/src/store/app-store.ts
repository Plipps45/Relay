import { create } from 'zustand'
import { findAgent } from '@shared/agents'
import type {
  AgentAvailability,
  AgentStatus,
  GitStatus,
  Project,
  Settings,
  TabSession,
  TerminalPaneSession,
  UiState,
  Workspace,
  WorkspaceSession,
  WorkspaceStatus
} from '@shared/types'
import { newId, paneIds, removePane, splitPane } from '@/lib/split-layout'

export type PaneRuntime = {
  status: AgentStatus | null
  title: string
  agentId: string | null
  exited: boolean
}

export type PendingLaunch = {
  command: string | null
  followupPrompt: string | null
}

export type Toast = { id: string; kind: 'info' | 'error' | 'success'; message: string }

export type PaletteMode = 'files' | 'workspaces' | null

export type DialogState =
  | { kind: 'composer'; projectId?: string; prompt?: string }
  | { kind: 'add-project' }
  | { kind: 'settings'; section?: string }
  | { kind: 'delete-workspace'; workspaceId: string }
  | { kind: 'rename-workspace'; workspaceId: string }
  | { kind: 'project-settings'; projectId: string }
  | null

type TerminalOptions = {
  title?: string
  command?: string | null
  followupPrompt?: string | null
  agentId?: string | null
  cwd?: string
}

type AppState = {
  loaded: boolean
  projects: Project[]
  workspaces: Workspace[]
  settings: Settings | null
  ui: UiState | null
  sessions: Record<string, WorkspaceSession>
  agents: AgentAvailability[]
  gitStatus: Record<string, GitStatus>
  paneRuntime: Record<string, PaneRuntime>
  activePaneByTab: Record<string, string>
  pendingLaunch: Record<string, PendingLaunch>
  unread: Record<string, boolean>
  dialog: DialogState
  palette: PaletteMode
  toasts: Toast[]
  windowFocused: boolean
  leftSidebarOpen: boolean
  searchFocusToken: number
  pendingReveal: { path: string; line: number } | null
}

type AppActions = {
  init: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  refreshAgents: (force?: boolean) => Promise<void>
  refreshGit: (workspaceId: string) => Promise<void>
  selectWorkspace: (workspaceId: string | null) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  updateUi: (patch: Partial<UiState>) => void
  updateWorkspaceMeta: (workspaceId: string, patch: Partial<Pick<Workspace, 'displayName' | 'status' | 'pinned' | 'comments' | 'lastActiveAt'>>) => Promise<void>
  setWorkspaceStatus: (workspaceId: string, status: WorkspaceStatus) => void
  openTerminalTab: (workspaceId: string, options?: TerminalOptions) => string
  splitActivePane: (workspaceId: string, direction: 'row' | 'column') => void
  closePane: (workspaceId: string, tabId: string, paneId: string) => void
  setActivePane: (tabId: string, paneId: string) => void
  openEditorTab: (workspaceId: string, filePath: string, line?: number, title?: string) => void
  openDiffTab: (workspaceId: string, filePath: string, staged: boolean) => void
  openChangesTab: (workspaceId: string) => void
  openBrowserTab: (workspaceId: string, url?: string) => void
  openNotesTab: (workspaceId: string, vaultPath?: string, notePath?: string | null) => void
  updateTab: (workspaceId: string, tabId: string, patch: Partial<TabSession>) => void
  updatePane: (workspaceId: string, tabId: string, paneId: string, patch: Partial<TerminalPaneSession>) => void
  setActiveTab: (workspaceId: string, tabId: string) => void
  closeTab: (workspaceId: string, tabId: string) => void
  moveTab: (workspaceId: string, fromId: string, toId: string) => void
  setPaneRuntime: (paneId: string, patch: Partial<PaneRuntime>) => void
  consumePendingLaunch: (paneId: string) => PendingLaunch | null
  markUnread: (workspaceId: string, unread: boolean) => void
  setDialog: (dialog: DialogState) => void
  setPalette: (mode: PaletteMode) => void
  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  setWindowFocused: (focused: boolean) => void
  toggleLeftSidebar: () => void
  focusSearch: () => void
  clearPendingReveal: () => void
}

export type Store = AppState & AppActions

const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()

function persistSession(workspaceId: string, session: WorkspaceSession | undefined): void {
  const existing = sessionTimers.get(workspaceId)
  if (existing) {
    clearTimeout(existing)
  }
  sessionTimers.set(
    workspaceId,
    setTimeout(() => {
      sessionTimers.delete(workspaceId)
      void window.relay.state.setSession(workspaceId, session ?? null)
    }, 400)
  )
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export const useStore = create<Store>((set, get) => {
  const mutateSession = (workspaceId: string, mutator: (session: WorkspaceSession) => WorkspaceSession): void => {
    const current = get().sessions[workspaceId] ?? { tabs: [], activeTabId: null }
    const next = mutator(current)
    set((state) => ({ sessions: { ...state.sessions, [workspaceId]: next } }))
    persistSession(workspaceId, next)
  }

  const addTab = (workspaceId: string, tab: TabSession): void => {
    mutateSession(workspaceId, (session) => ({ tabs: [...session.tabs, tab], activeTabId: tab.id }))
  }

  return {
    loaded: false,
    projects: [],
    workspaces: [],
    settings: null,
    ui: null,
    sessions: {},
    agents: [],
    gitStatus: {},
    paneRuntime: {},
    activePaneByTab: {},
    pendingLaunch: {},
    unread: {},
    dialog: null,
    palette: null,
    toasts: [],
    windowFocused: true,
    leftSidebarOpen: true,
    searchFocusToken: 0,
    pendingReveal: null,

    async init() {
      const state = await window.relay.state.get()
      set({
        projects: state.projects,
        settings: state.settings,
        ui: state.ui,
        sessions: state.sessions ?? {}
      })
      await get().refreshWorkspaces()
      const workspaces = get().workspaces
      const active = state.ui.activeWorkspaceId
      set({ loaded: true })
      if (active && workspaces.some((w) => w.id === active)) {
        get().selectWorkspace(active)
      }
      void get().refreshAgents()
    },

    async refreshWorkspaces() {
      const [state, workspaces] = await Promise.all([window.relay.state.get(), window.relay.workspaces.list()])
      set({ projects: state.projects, workspaces })
    },

    async refreshAgents(force = false) {
      set({ agents: await window.relay.agents.detect(force) })
    },

    async refreshGit(workspaceId) {
      const workspace = get().workspaces.find((w) => w.id === workspaceId)
      if (!workspace || workspace.isFolder) {
        return
      }
      try {
        const status = await window.relay.git.status(workspace.path)
        set((state) => ({ gitStatus: { ...state.gitStatus, [workspaceId]: status } }))
      } catch {
        // A worktree removed outside the app; the next list refresh drops it.
      }
    },

    selectWorkspace(workspaceId) {
      const ui = get().ui
      if (!ui) {
        return
      }
      set({ ui: { ...ui, activeWorkspaceId: workspaceId } })
      void window.relay.state.updateUi({ activeWorkspaceId: workspaceId })
      if (!workspaceId) {
        return
      }
      get().markUnread(workspaceId, false)
      void get().updateWorkspaceMeta(workspaceId, { lastActiveAt: Date.now() })
      const session = get().sessions[workspaceId]
      if (!session || session.tabs.length === 0) {
        get().openTerminalTab(workspaceId)
      }
      void get().refreshGit(workspaceId)
    },

    async updateSettings(patch) {
      // Optimistic so controlled inputs never lag behind the IPC round trip.
      const current = get().settings
      if (current) {
        set({ settings: { ...current, ...patch } })
      }
      await window.relay.state.updateSettings(patch)
    },

    updateUi(patch) {
      const ui = get().ui
      if (!ui) {
        return
      }
      set({ ui: { ...ui, ...patch } })
      void window.relay.state.updateUi(patch)
    },

    async updateWorkspaceMeta(workspaceId, patch) {
      set((state) => ({
        workspaces: state.workspaces.map((w) => (w.id === workspaceId ? { ...w, ...patch } : w))
      }))
      await window.relay.workspaces.updateMeta(workspaceId, patch)
    },

    setWorkspaceStatus(workspaceId, status) {
      void get().updateWorkspaceMeta(workspaceId, { status })
    },

    openTerminalTab(workspaceId, options = {}) {
      const workspace = get().workspaces.find((w) => w.id === workspaceId)
      const paneId = newId('pane')
      const tabId = newId('tab')
      const agent = findAgent(options.agentId)
      const terminalCount = (get().sessions[workspaceId]?.tabs ?? []).filter((t) => t.kind === 'terminal').length
      const title = options.title ?? agent?.label ?? (terminalCount === 0 ? 'Terminal' : `Terminal ${terminalCount + 1}`)
      if (options.command) {
        set((state) => ({
          pendingLaunch: {
            ...state.pendingLaunch,
            [paneId]: { command: options.command ?? null, followupPrompt: options.followupPrompt ?? null }
          }
        }))
      }
      set((state) => ({
        paneRuntime: {
          ...state.paneRuntime,
          [paneId]: { status: null, title, agentId: agent?.id ?? null, exited: false }
        },
        activePaneByTab: { ...state.activePaneByTab, [tabId]: paneId }
      }))
      addTab(workspaceId, {
        id: tabId,
        kind: 'terminal',
        title,
        layout: { type: 'pane', paneId },
        panes: [{ id: paneId, cwd: options.cwd ?? workspace?.path ?? '', title, agentId: agent?.id ?? null }]
      })
      return paneId
    },

    splitActivePane(workspaceId, direction) {
      const session = get().sessions[workspaceId]
      const tab = session?.tabs.find((t) => t.id === session.activeTabId)
      if (!tab || tab.kind !== 'terminal') {
        get().openTerminalTab(workspaceId)
        return
      }
      const activePane = get().activePaneByTab[tab.id] ?? paneIds(tab.layout)[0]
      const source = tab.panes.find((p) => p.id === activePane)
      const workspace = get().workspaces.find((w) => w.id === workspaceId)
      const paneId = newId('pane')
      set((state) => ({
        paneRuntime: { ...state.paneRuntime, [paneId]: { status: null, title: 'Terminal', agentId: null, exited: false } },
        activePaneByTab: { ...state.activePaneByTab, [tab.id]: paneId }
      }))
      mutateSession(workspaceId, (s) => ({
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === tab.id && t.kind === 'terminal'
            ? {
                ...t,
                layout: splitPane(t.layout, activePane, paneId, direction),
                panes: [...t.panes, { id: paneId, cwd: source?.cwd ?? workspace?.path ?? '', title: 'Terminal', agentId: null }]
              }
            : t
        )
      }))
    },

    closePane(workspaceId, tabId, paneId) {
      const session = get().sessions[workspaceId]
      const tab = session?.tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== 'terminal') {
        return
      }
      const layout = removePane(tab.layout, paneId)
      window.relay.pty.kill(paneId)
      if (!layout) {
        get().closeTab(workspaceId, tabId)
        return
      }
      const remaining = paneIds(layout)
      set((state) => ({ activePaneByTab: { ...state.activePaneByTab, [tabId]: remaining[remaining.length - 1] } }))
      mutateSession(workspaceId, (s) => ({
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === 'terminal' ? { ...t, layout, panes: t.panes.filter((p) => p.id !== paneId) } : t
        )
      }))
    },

    setActivePane(tabId, paneId) {
      if (get().activePaneByTab[tabId] !== paneId) {
        set((state) => ({ activePaneByTab: { ...state.activePaneByTab, [tabId]: paneId } }))
      }
    },

    openEditorTab(workspaceId, filePath, line, title) {
      const session = get().sessions[workspaceId]
      const existing = session?.tabs.find((t) => t.kind === 'editor' && t.filePath === filePath)
      if (line) {
        set({ pendingReveal: { path: filePath, line } })
      }
      if (existing) {
        get().setActiveTab(workspaceId, existing.id)
        return
      }
      addTab(workspaceId, { id: newId('tab'), kind: 'editor', title: title ?? basename(filePath), filePath })
    },

    openDiffTab(workspaceId, filePath, staged) {
      const session = get().sessions[workspaceId]
      const existing = session?.tabs.find((t) => t.kind === 'diff' && t.filePath === filePath && t.staged === staged)
      if (existing) {
        get().setActiveTab(workspaceId, existing.id)
        return
      }
      addTab(workspaceId, { id: newId('tab'), kind: 'diff', title: basename(filePath), filePath, staged })
    },

    openChangesTab(workspaceId) {
      const session = get().sessions[workspaceId]
      const existing = session?.tabs.find((t) => t.kind === 'changes')
      if (existing) {
        get().setActiveTab(workspaceId, existing.id)
        return
      }
      addTab(workspaceId, { id: newId('tab'), kind: 'changes', title: 'All Changes' })
    },

    openBrowserTab(workspaceId, url = 'http://localhost:3000') {
      addTab(workspaceId, { id: newId('tab'), kind: 'browser', title: 'Browser', url })
    },

    openNotesTab(workspaceId, vaultPath, notePath = null) {
      const vault = vaultPath ?? get().settings?.notesVault ?? ''
      const existing = get().sessions[workspaceId]?.tabs.find(
        (t) => t.kind === 'notes' && (!vault || t.vaultPath.toLowerCase() === vault.toLowerCase())
      )
      if (existing) {
        if (notePath) {
          get().updateTab(workspaceId, existing.id, { notePath })
        }
        get().setActiveTab(workspaceId, existing.id)
        return
      }
      // An empty vault is filled in by the tab from Obsidian's own vault list.
      addTab(workspaceId, { id: newId('tab'), kind: 'notes', title: 'Notes', vaultPath: vault, notePath })
    },

    updateTab(workspaceId, tabId, patch) {
      mutateSession(workspaceId, (s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === tabId ? ({ ...t, ...patch } as TabSession) : t))
      }))
    },

    updatePane(workspaceId, tabId, paneId, patch) {
      mutateSession(workspaceId, (s) => ({
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === 'terminal'
            ? { ...t, panes: t.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p)) }
            : t
        )
      }))
    },

    setActiveTab(workspaceId, tabId) {
      if (get().sessions[workspaceId]?.activeTabId === tabId) {
        return
      }
      mutateSession(workspaceId, (s) => ({ ...s, activeTabId: tabId }))
    },

    closeTab(workspaceId, tabId) {
      const session = get().sessions[workspaceId]
      const tab = session?.tabs.find((t) => t.id === tabId)
      if (!session || !tab) {
        return
      }
      if (tab.kind === 'terminal') {
        for (const pane of tab.panes) {
          window.relay.pty.kill(pane.id)
        }
      }
      mutateSession(workspaceId, (s) => {
        const index = s.tabs.findIndex((t) => t.id === tabId)
        const tabs = s.tabs.filter((t) => t.id !== tabId)
        const activeTabId =
          s.activeTabId === tabId ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeTabId
        return { tabs, activeTabId }
      })
    },

    moveTab(workspaceId, fromId, toId) {
      mutateSession(workspaceId, (s) => {
        const tabs = [...s.tabs]
        const from = tabs.findIndex((t) => t.id === fromId)
        const to = tabs.findIndex((t) => t.id === toId)
        if (from === -1 || to === -1) {
          return s
        }
        const [moved] = tabs.splice(from, 1)
        tabs.splice(to, 0, moved)
        return { ...s, tabs }
      })
    },

    setPaneRuntime(paneId, patch) {
      const current = get().paneRuntime[paneId] ?? { status: null, title: '', agentId: null, exited: false }
      const next = { ...current, ...patch }
      if (
        next.status === current.status &&
        next.title === current.title &&
        next.agentId === current.agentId &&
        next.exited === current.exited
      ) {
        return
      }
      set((state) => ({ paneRuntime: { ...state.paneRuntime, [paneId]: next } }))
    },

    consumePendingLaunch(paneId) {
      const launch = get().pendingLaunch[paneId] ?? null
      if (launch) {
        set((state) => {
          const { [paneId]: _removed, ...rest } = state.pendingLaunch
          return { pendingLaunch: rest }
        })
      }
      return launch
    },

    markUnread(workspaceId, unread) {
      if (Boolean(get().unread[workspaceId]) === unread) {
        return
      }
      set((state) => ({ unread: { ...state.unread, [workspaceId]: unread } }))
    },

    setDialog(dialog) {
      set({ dialog })
    },

    setPalette(mode) {
      set({ palette: mode })
    },

    toast(kind, message) {
      const id = newId('toast')
      set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500)
    },

    dismissToast(id) {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },

    setWindowFocused(focused) {
      set({ windowFocused: focused })
    },

    toggleLeftSidebar() {
      set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen }))
    },

    focusSearch() {
      set((state) => ({ searchFocusToken: state.searchFocusToken + 1 }))
    },

    clearPendingReveal() {
      set({ pendingReveal: null })
    }
  }
})

export function activeWorkspace(state: Store): Workspace | undefined {
  const id = state.ui?.activeWorkspaceId
  return id ? state.workspaces.find((w) => w.id === id) : undefined
}

/** Aggregate agent status for a workspace: any pane asking wins over working, working over idle. */
export function workspaceAgentStatus(state: Store, workspaceId: string): AgentStatus | null {
  const session = state.sessions[workspaceId]
  if (!session) {
    return null
  }
  let result: AgentStatus | null = null
  for (const tab of session.tabs) {
    if (tab.kind !== 'terminal') {
      continue
    }
    for (const pane of tab.panes) {
      const status = state.paneRuntime[pane.id]?.status ?? null
      if (status === 'permission') {
        return 'permission'
      }
      if (status === 'working') {
        result = 'working'
      } else if (status === 'idle' && result === null) {
        result = 'idle'
      }
    }
  }
  return result
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown in ipcMain handlers.
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
