import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PersistedState, Settings, UiState, WorkspaceSession } from '@shared/types'

export function defaultWorkspaceDir(): string {
  return join(homedir(), 'relay', 'workspaces')
}

/**
 * The app used to be called Pod, which kept its data in a sibling userData
 * folder. Projects, settings and sessions are copied over once, and the old
 * default worktree folder follows the rename; existing worktrees keep their paths.
 */
function importLegacyState(dir: string): void {
  const legacy = join(app.getPath('appData'), 'Pod')
  if (existsSync(join(dir, 'state.json')) || !existsSync(join(legacy, 'state.json'))) {
    return
  }
  try {
    for (const file of ['state.json', 'sessions.json']) {
      if (existsSync(join(legacy, file))) {
        copyFileSync(join(legacy, file), join(dir, file))
      }
    }
    const path = join(dir, 'state.json')
    const state = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedState>
    if (state.settings?.workspaceDir === join(homedir(), 'pod', 'workspaces')) {
      state.settings.workspaceDir = defaultWorkspaceDir()
      writeFileSync(path, JSON.stringify(state))
    }
  } catch {
    // A failed import starts fresh; the legacy folder is left untouched.
  }
}

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    workspaceDir: defaultWorkspaceDir(),
    nestWorkspaces: true,
    branchPrefix: 'git-username',
    branchPrefixCustom: '',
    defaultAgent: null,
    agentCommandOverrides: {},
    terminalFontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace",
    terminalFontSize: 13,
    terminalScrollback: 10000,
    editorFontSize: 13,
    editorAutoSave: true,
    notifyOnAgentDone: true,
    notifyOnlyWhenUnfocused: true,
    runSetupScript: true,
    deleteBranchWithWorkspace: false,
    confirmBeforeDelete: true,
    shell: '',
    notesVault: ''
  }
}

function defaultUi(): UiState {
  return {
    sidebarWidth: 280,
    rightSidebarWidth: 320,
    rightSidebarOpen: true,
    rightSidebarTab: 'explorer',
    groupBy: 'status',
    activeWorkspaceId: null
  }
}

function defaultState(): PersistedState {
  return {
    version: 1,
    projects: [],
    workspaceMeta: {},
    retiredNames: {},
    settings: defaultSettings(),
    ui: defaultUi(),
    sessions: {}
  }
}

/**
 * Single JSON document under userData. Sessions (tabs + terminal scrollback)
 * live in their own file because they are large and rewritten often.
 */
class StateStore {
  private state: PersistedState
  private readonly dir: string
  private saveTimer: NodeJS.Timeout | null = null
  private sessionTimer: NodeJS.Timeout | null = null

  constructor() {
    this.dir = app.getPath('userData')
    mkdirSync(this.dir, { recursive: true })
    importLegacyState(this.dir)
    const loaded = this.read<Partial<PersistedState>>('state.json') ?? {}
    const base = defaultState()
    this.state = {
      ...base,
      ...loaded,
      settings: { ...base.settings, ...(loaded.settings ?? {}) },
      ui: { ...base.ui, ...(loaded.ui ?? {}) },
      sessions: this.read<Record<string, WorkspaceSession>>('sessions.json') ?? {}
    }
  }

  private read<T>(file: string): T | null {
    const path = join(this.dir, file)
    if (!existsSync(path)) {
      return null
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
      return null
    }
  }

  private writeAtomic(file: string, data: unknown): void {
    const path = join(this.dir, file)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, path)
  }

  get(): PersistedState {
    return this.state
  }

  update(mutator: (state: PersistedState) => void): PersistedState {
    mutator(this.state)
    this.scheduleSave()
    return this.state
  }

  setSession(workspaceId: string, session: WorkspaceSession | null): void {
    if (session) {
      this.state.sessions[workspaceId] = session
    } else {
      delete this.state.sessions[workspaceId]
    }
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer)
    }
    this.sessionTimer = setTimeout(() => this.flushSessions(), 800)
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => this.flushState(), 250)
  }

  private flushState(): void {
    this.saveTimer = null
    const { sessions: _sessions, ...rest } = this.state
    this.writeAtomic('state.json', rest)
  }

  private flushSessions(): void {
    this.sessionTimer = null
    this.writeAtomic('sessions.json', this.state.sessions)
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer)
    }
    this.flushState()
    this.flushSessions()
  }
}

let instance: StateStore | null = null

export function store(): StateStore {
  if (!instance) {
    instance = new StateStore()
  }
  return instance
}
