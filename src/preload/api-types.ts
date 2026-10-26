import type {
  AgentAvailability,
  BranchRef,
  CreateWorkspaceRequest,
  CreateWorkspaceResult,
  DirEntry,
  GitStatus,
  ObsidianVault,
  PersistedState,
  ProjectSkills,
  Project,
  RemoveWorkspaceRequest,
  SearchMatch,
  SkillInfo,
  Settings,
  UiState,
  VaultIndex,
  Workspace,
  WorkspaceMeta,
  WorkspaceSession
} from '../shared/types'
import type { ClaudeUsage } from '../shared/claude-usage'

export type ShellKind = 'powershell' | 'cmd' | 'posix'

export type FileContent =
  | { kind: 'text'; content: string; size: number }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }

export type DiffMode = 'staged' | 'unstaged' | 'untracked'

export type PtySpawnRequest = {
  id: string
  cwd: string
  cols: number
  rows: number
  command?: string | null
  followupPrompt?: string | null
  env?: Record<string, string>
}

export type RelayApi = {
  platform: string
  state: {
    get: () => Promise<PersistedState>
    updateSettings: (patch: Partial<Settings>) => Promise<Settings>
    updateUi: (patch: Partial<UiState>) => Promise<void>
    setSession: (workspaceId: string, session: WorkspaceSession | null) => Promise<void>
  }
  dialog: {
    pickFolder: (title?: string) => Promise<string | null>
  }
  projects: {
    add: (path: string) => Promise<Project>
    update: (id: string, patch: Partial<Project>) => Promise<void>
    remove: (id: string) => Promise<void>
    clone: (url: string, parentDir: string) => Promise<Project>
  }
  workspaces: {
    list: () => Promise<Workspace[]>
    create: (request: CreateWorkspaceRequest) => Promise<CreateWorkspaceResult>
    remove: (request: RemoveWorkspaceRequest) => Promise<void>
    updateMeta: (path: string, patch: Partial<WorkspaceMeta>) => Promise<void>
    suggestName: (projectId: string) => Promise<string>
  }
  git: {
    status: (cwd: string) => Promise<GitStatus>
    branches: (cwd: string) => Promise<BranchRef[]>
    defaultBase: (cwd: string) => Promise<string | null>
    stage: (cwd: string, paths: string[]) => Promise<void>
    unstage: (cwd: string, paths: string[]) => Promise<void>
    discard: (cwd: string, paths: string[], untracked: string[]) => Promise<void>
    commit: (cwd: string, message: string, all: boolean) => Promise<void>
    push: (cwd: string) => Promise<void>
    pull: (cwd: string) => Promise<void>
    log: (cwd: string, limit: number) => Promise<{ hash: string; subject: string; author: string; date: number }[]>
    diffContents: (cwd: string, path: string, oldPath: string | undefined, mode: DiffMode) => Promise<{ original: string; modified: string }>
  }
  fs: {
    readDir: (path: string) => Promise<DirEntry[]>
    readFile: (path: string) => Promise<FileContent>
    writeFile: (path: string, content: string) => Promise<void>
    create: (path: string, directory: boolean) => Promise<void>
    rename: (from: string, to: string) => Promise<void>
    trash: (path: string) => Promise<void>
    listFiles: (root: string) => Promise<string[]>
    search: (root: string, query: string, options: { caseSensitive: boolean; regex: boolean; limit: number }) => Promise<SearchMatch[]>
    exists: (path: string) => Promise<boolean>
    watch: (workspaceId: string, root: string) => void
    unwatch: (workspaceId: string) => void
    onChanged: (listener: (workspaceId: string, paths: string[]) => void) => () => void
    pathForFile: (file: File) => string
  }
  pty: {
    spawn: (request: PtySpawnRequest) => Promise<{ pid: number; shell: ShellKind }>
    shellKind: () => Promise<ShellKind>
    isAlive: (id: string) => Promise<boolean>
    write: (id: string, data: string) => void
    resize: (id: string, cols: number, rows: number) => void
    kill: (id: string) => void
    onData: (listener: (id: string, data: string) => void) => () => void
    onExit: (listener: (id: string, exitCode: number) => void) => () => void
  }
  agents: {
    detect: (force: boolean) => Promise<AgentAvailability[]>
  }
  skills: {
    list: (projectId: string) => Promise<ProjectSkills>
    setEnabled: (projectId: string, keys: string[], enabled: boolean) => Promise<void>
    adapt: (projectId: string, key: string) => Promise<SkillInfo>
    remove: (projectId: string, key: string) => Promise<void>
    files: (dir: string) => Promise<string[]>
  }
  usage: {
    get: () => Promise<ClaudeUsage>
  }
  obsidian: {
    vaults: () => Promise<ObsidianVault[]>
    index: (root: string) => Promise<VaultIndex>
    search: (root: string, query: string, limit: number) => Promise<SearchMatch[]>
    create: (root: string, path: string, content: string) => Promise<string>
    template: (root: string, template: string) => Promise<string>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    showItem: (path: string) => Promise<void>
    openPath: (path: string) => Promise<string>
    openInEditor: (path: string) => Promise<boolean>
  }
  app: {
    notify: (payload: { title: string; body: string; workspaceId: string }) => Promise<void>
    saveImage: (base64Png: string) => Promise<string>
    onNotificationClick: (listener: (workspaceId: string) => void) => () => void
    onFocusChange: (listener: (focused: boolean) => void) => () => void
    onBeforeClose: (listener: () => void) => () => void
    closeReady: () => void
    setTitleBarOverlay: (color: string, symbolColor: string) => Promise<void>
  }
}
