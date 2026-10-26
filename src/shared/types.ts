export type ThemePreference = 'system' | 'dark' | 'light'

export type BranchPrefixStrategy = 'git-username' | 'custom' | 'none'

export type WorkspaceStatus = 'todo' | 'in-progress' | 'in-review' | 'completed'

export type AgentStatus = 'working' | 'permission' | 'idle'

export type GroupBy = 'status' | 'project' | 'none'

export type Project = {
  id: string
  name: string
  path: string
  color: string
  isGit: boolean
  setupScript: string
  addedAt: number
}

export type DiffComment = {
  id: string
  filePath: string
  line: number
  side: 'original' | 'modified'
  text: string
  createdAt: number
}

/** User-owned metadata that git does not store, keyed by the worktree path. */
export type WorkspaceMeta = {
  displayName?: string
  status?: WorkspaceStatus
  pinned?: boolean
  createdAt?: number
  lastActiveAt?: number
  comments?: DiffComment[]
}

export type Workspace = {
  id: string
  projectId: string
  path: string
  branch: string | null
  head: string | null
  isMain: boolean
  isFolder: boolean
  displayName: string
  status: WorkspaceStatus
  pinned: boolean
  createdAt: number
  lastActiveAt: number
  comments: DiffComment[]
}

export type Settings = {
  theme: ThemePreference
  workspaceDir: string
  nestWorkspaces: boolean
  branchPrefix: BranchPrefixStrategy
  branchPrefixCustom: string
  defaultAgent: string | null
  agentCommandOverrides: Record<string, string>
  terminalFontFamily: string
  terminalFontSize: number
  terminalScrollback: number
  editorFontSize: number
  editorAutoSave: boolean
  notifyOnAgentDone: boolean
  notifyOnlyWhenUnfocused: boolean
  runSetupScript: boolean
  deleteBranchWithWorkspace: boolean
  confirmBeforeDelete: boolean
  shell: string
  /** Obsidian vault the Notes tab opens by default; empty means the vault Obsidian last had open. */
  notesVault: string
}

export type TerminalPaneSession = {
  id: string
  cwd: string
  title: string
  scrollback?: string
  agentId?: string | null
}

export type SplitNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; direction: 'row' | 'column'; children: SplitNode[]; sizes: number[] }

export type TabSession =
  | { id: string; kind: 'terminal'; title: string; layout: SplitNode; panes: TerminalPaneSession[] }
  | { id: string; kind: 'editor'; title: string; filePath: string }
  | { id: string; kind: 'diff'; title: string; filePath: string; staged: boolean }
  | { id: string; kind: 'changes'; title: string }
  | { id: string; kind: 'browser'; title: string; url: string }
  | { id: string; kind: 'notes'; title: string; vaultPath: string; notePath: string | null }

export type WorkspaceSession = {
  tabs: TabSession[]
  activeTabId: string | null
}

export type UiState = {
  sidebarWidth: number
  rightSidebarWidth: number
  rightSidebarOpen: boolean
  rightSidebarTab: 'explorer' | 'changes' | 'search' | 'skills'
  groupBy: GroupBy
  activeWorkspaceId: string | null
}

export type PersistedState = {
  version: 1
  projects: Project[]
  workspaceMeta: Record<string, WorkspaceMeta>
  retiredNames: Record<string, string[]>
  settings: Settings
  ui: UiState
  sessions: Record<string, WorkspaceSession>
  /** Local date (Y-M-D) of the last automatic update check. */
  lastUpdateCheck?: string
}

export type UpdateStatus =
  | { state: 'idle' | 'checking' | 'up-to-date' }
  | { state: 'available' | 'downloading' | 'ready'; version: string }
  | { state: 'error'; message: string }

export type AgentAvailability = {
  id: string
  installed: boolean
  resolvedPath: string | null
}

export type GitFileStatus = {
  path: string
  oldPath?: string
  index: string
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export type GitStatus = {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type SearchMatch = {
  filePath: string
  line: number
  text: string
}

export type CreateWorkspaceRequest = {
  projectId: string
  name: string
  baseRef: string | null
  prompt: string
  agentId: string | null
}

export type CreateWorkspaceResult = {
  workspace: Workspace
  setupScript: string | null
}

export type RemoveWorkspaceRequest = {
  workspaceId: string
  deleteBranch: boolean
  force: boolean
}

export type BranchRef = {
  name: string
  remote: boolean
  current: boolean
}

/** Where Claude Code loads a skill from: ~/.claude/skills, claude.ai sync, an installed plugin, or the project's .claude/skills. */
export type SkillSource = 'personal' | 'synced' | 'plugin' | 'project'

export type SkillInfo = {
  /** The name Claude lists the skill under, which is also its `skillOverrides` key. */
  key: string
  name: string
  description: string
  source: SkillSource
  dir: string
  file: string
  /** Key of the global skill a project `<name>-local` copy was adapted from. */
  adaptedFrom: string | null
  /** A personal skill with the same name wins, so this project skill never loads. */
  shadowed: boolean
}

export type ProjectSkills = {
  skills: SkillInfo[]
  /** `skillOverrides` from the project's .claude/settings.local.json; absent keys are "on". */
  overrides: Record<string, string>
  globalDir: string
  settingsPath: string
}

/** A vault registered in Obsidian's own obsidian.json. */
export type ObsidianVault = {
  id: string
  name: string
  path: string
  open: boolean
}

export type VaultNote = {
  /** Vault-relative path with forward slashes. */
  path: string
  title: string
  mtime: number
  links: string[]
  embeds: string[]
  tags: string[]
  aliases: string[]
}

export type VaultIndex = {
  root: string
  notes: VaultNote[]
  /** Vault-relative paths of attachments (everything that isn't a note). */
  files: string[]
  /** Settings from .obsidian/daily-notes.json, when the core plugin is configured. */
  dailyNotes: { folder: string; format: string; template: string }
}
