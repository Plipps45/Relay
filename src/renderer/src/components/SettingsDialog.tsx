import { useEffect, useState, type ReactNode } from 'react'
import { Bell, Bot, ExternalLink, FolderOpen, GitBranch, Keyboard, NotebookText, Palette, RefreshCw, SquareTerminal } from 'lucide-react'
import { AGENTS } from '@shared/agents'
import type { ObsidianVault, Settings } from '@shared/types'
import { useStore } from '@/store/app-store'
import { resetShellKindCache } from '@/lib/launch-agent'
import { BINDINGS } from '@/lib/shortcuts'
import { AgentMonogram } from './badges'
import { Button, Dialog, IconButton, Input, Kbd, Select, Switch, cn } from './ui'

const SECTIONS = [
  { id: 'general', label: 'Appearance', icon: Palette },
  { id: 'workspaces', label: 'Workspaces', icon: GitBranch },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'terminal', label: 'Terminal & editor', icon: SquareTerminal },
  { id: 'notes', label: 'Notes', icon: NotebookText },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard }
] as const

const SHORTCUT_LABELS: Record<string, string> = {
  newWorkspace: 'New workspace',
  newTerminal: 'New terminal tab',
  newBrowser: 'New browser tab',
  notes: 'Notes (Obsidian vault)',
  closeTab: 'Close tab',
  closePane: 'Close pane',
  quickOpen: 'Go to file',
  jumpWorkspace: 'Jump to workspace',
  settings: 'Settings',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  splitRight: 'Split terminal right',
  splitDown: 'Split terminal down',
  toggleLeftSidebar: 'Toggle workspace sidebar',
  explorer: 'Explorer',
  sourceControl: 'Source control',
  search: 'Search in workspace',
  nextWorkspace: 'Next workspace',
  prevWorkspace: 'Previous workspace',
  focusNextPane: 'Focus next pane',
  focusPrevPane: 'Focus previous pane'
}

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDialog({ initialSection }: { initialSection?: string }): ReactNode {
  const settings = useStore((s) => s.settings)
  const agents = useStore((s) => s.agents)
  const updateSettings = useStore((s) => s.updateSettings)
  const refreshAgents = useStore((s) => s.refreshAgents)
  const setDialog = useStore((s) => s.setDialog)
  const [section, setSection] = useState<string>(initialSection ?? 'general')
  const [vaults, setVaults] = useState<ObsidianVault[]>([])
  useEffect(() => {
    void window.relay.obsidian.vaults().then(setVaults, () => undefined)
  }, [])
  if (!settings) {
    return null
  }
  const set = (patch: Partial<Settings>): void => void updateSettings(patch)

  return (
    <Dialog title="Settings" onClose={() => setDialog(null)} width={820}>
      <div className="flex min-h-[460px] gap-5">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn('flex h-8 items-center gap-2 rounded-md px-2 text-[13px]', section === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60')}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'general' ? (
            <>
              <Row title="Theme">
                <div className="flex rounded-md border border-border p-0.5">
                  {(['system', 'light', 'dark'] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      onClick={() => set({ theme })}
                      className={cn('h-7 rounded px-3 text-xs capitalize', settings.theme === theme ? 'bg-accent font-medium' : 'text-muted-foreground')}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </Row>
            </>
          ) : null}

          {section === 'workspaces' ? (
            <>
              <Row title="Workspace folder" description="New worktrees are created here.">
                <div className="flex w-80 gap-1.5">
                  <Input value={settings.workspaceDir} onChange={(e) => set({ workspaceDir: e.target.value })} className="font-mono text-xs" />
                  <IconButton
                    label="Choose folder"
                    className="size-8 border border-input"
                    onClick={() => void window.relay.dialog.pickFolder('Workspace folder').then((path) => path && set({ workspaceDir: path }))}
                  >
                    <FolderOpen className="size-3.5" />
                  </IconButton>
                </div>
              </Row>
              <Row title="Group by project" description="Nest worktrees in a subfolder named after the project.">
                <Switch checked={settings.nestWorkspaces} onChange={(nestWorkspaces) => set({ nestWorkspaces })} />
              </Row>
              <Row title="Branch prefix" description="New branches are named prefix/workspace-name.">
                <div className="flex w-80 gap-1.5">
                  <Select
                    value={settings.branchPrefix}
                    onChange={(branchPrefix) => set({ branchPrefix })}
                    options={[
                      { value: 'git-username', label: 'Git user name' },
                      { value: 'custom', label: 'Custom' },
                      { value: 'none', label: 'None' }
                    ]}
                  />
                  {settings.branchPrefix === 'custom' ? (
                    <Input value={settings.branchPrefixCustom} placeholder="feature" onChange={(e) => set({ branchPrefixCustom: e.target.value })} />
                  ) : null}
                </div>
              </Row>
              <Row title="Run setup script" description="Run the project's setup script in a new tab after creating a workspace.">
                <Switch checked={settings.runSetupScript} onChange={(runSetupScript) => set({ runSetupScript })} />
              </Row>
              <Row title="Delete branch with workspace" description="Default for the checkbox in the delete dialog.">
                <Switch checked={settings.deleteBranchWithWorkspace} onChange={(deleteBranchWithWorkspace) => set({ deleteBranchWithWorkspace })} />
              </Row>
            </>
          ) : null}

          {section === 'agents' ? (
            <>
              <Row title="Default agent" description="Preselected in the new workspace composer.">
                <div className="w-56">
                  <Select
                    value={settings.defaultAgent ?? ''}
                    onChange={(value) => set({ defaultAgent: value || null })}
                    options={[{ value: '', label: 'First installed' }, ...AGENTS.map((a) => ({ value: a.id, label: a.label }))]}
                  />
                </div>
              </Row>
              <div className="mt-3 mb-2 flex items-center justify-between">
                <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">Agent CLIs</span>
                <Button size="sm" variant="ghost" onClick={() => void refreshAgents(true)}>
                  <RefreshCw className="size-3" /> Rescan PATH
                </Button>
              </div>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {AGENTS.map((agent) => {
                  const availability = agents.find((a) => a.id === agent.id)
                  return (
                    <div key={agent.id} className="flex items-center gap-3 px-3 py-2">
                      <AgentMonogram agentId={agent.id} size={20} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className="truncate">{agent.label}</span>
                          {availability?.installed ? (
                            <span className="shrink-0 rounded-full bg-status-success/15 px-1.5 text-3xs whitespace-nowrap text-status-success">Installed</span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-muted px-1.5 text-3xs whitespace-nowrap text-muted-foreground">Not found</span>
                          )}
                        </div>
                        <div className="truncate font-mono text-2xs text-muted-foreground">{availability?.resolvedPath ?? agent.command}</div>
                      </div>
                      <Input
                        className="h-7 w-48 shrink-0 font-mono text-2xs"
                        placeholder={agent.launchCommand ?? agent.command}
                        value={settings.agentCommandOverrides[agent.id] ?? ''}
                        onChange={(e) => {
                          const next = { ...settings.agentCommandOverrides }
                          if (e.target.value.trim()) {
                            next[agent.id] = e.target.value
                          } else {
                            delete next[agent.id]
                          }
                          set({ agentCommandOverrides: next })
                        }}
                        title="Launch command override, e.g. claude --dangerously-skip-permissions"
                      />
                      <IconButton label="Install docs" onClick={() => void window.relay.shell.openExternal(agent.docsUrl)}>
                        <ExternalLink className="size-3.5" />
                      </IconButton>
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}

          {section === 'terminal' ? (
            <>
              <Row title="Shell" description="Empty picks PowerShell 7 when installed, else Windows PowerShell ($SHELL elsewhere). Applies to new terminals.">
                <Input
                  className="w-64 font-mono text-xs"
                  placeholder="pwsh.exe"
                  value={settings.shell}
                  onChange={(e) => {
                    resetShellKindCache()
                    set({ shell: e.target.value })
                  }}
                />
              </Row>
              <Row title="Terminal font">
                <Input className="w-64 font-mono text-xs" value={settings.terminalFontFamily} onChange={(e) => set({ terminalFontFamily: e.target.value })} />
              </Row>
              <Row title="Terminal font size">
                <Input
                  type="number"
                  min={8}
                  max={32}
                  className="w-20"
                  value={settings.terminalFontSize}
                  onChange={(e) => set({ terminalFontSize: Math.min(32, Math.max(8, Number(e.target.value) || 13)) })}
                />
              </Row>
              <Row title="Scrollback lines" description="Applies to new terminals.">
                <Input
                  type="number"
                  min={1000}
                  max={100000}
                  step={1000}
                  className="w-28"
                  value={settings.terminalScrollback}
                  onChange={(e) => set({ terminalScrollback: Math.min(100000, Math.max(1000, Number(e.target.value) || 10000)) })}
                />
              </Row>
              <Row title="Editor font size">
                <Input
                  type="number"
                  min={8}
                  max={32}
                  className="w-20"
                  value={settings.editorFontSize}
                  onChange={(e) => set({ editorFontSize: Math.min(32, Math.max(8, Number(e.target.value) || 13)) })}
                />
              </Row>
              <Row title="Autosave" description="Save editor changes 800 ms after you stop typing.">
                <Switch checked={settings.editorAutoSave} onChange={(editorAutoSave) => set({ editorAutoSave })} />
              </Row>
            </>
          ) : null}

          {section === 'notes' ? (
            <>
              <Row title="Default vault" description="Folder the Notes tab opens. Empty uses the vault Obsidian last had open.">
                <div className="flex w-80 gap-1.5">
                  <Input value={settings.notesVault} onChange={(e) => set({ notesVault: e.target.value })} placeholder={vaults[0]?.path ?? 'No Obsidian vault found'} className="font-mono text-xs" />
                  <IconButton
                    label="Choose folder"
                    className="size-8 border border-input"
                    onClick={() => void window.relay.dialog.pickFolder('Default vault').then((path) => path && set({ notesVault: path }))}
                  >
                    <FolderOpen className="size-3.5" />
                  </IconButton>
                </div>
              </Row>
              <Row title="Vaults registered in Obsidian" description="Read from Obsidian's obsidian.json.">
                <div className="flex w-80 flex-col gap-1">
                  {vaults.length ? (
                    vaults.map((vault) => (
                      <button
                        key={vault.id}
                        type="button"
                        title={vault.path}
                        onClick={() => set({ notesVault: vault.path })}
                        className={cn(
                          'flex h-7 items-center gap-2 rounded-md border border-border px-2 text-left text-xs hover:bg-accent',
                          settings.notesVault.toLowerCase() === vault.path.toLowerCase() && 'bg-accent font-medium'
                        )}
                      >
                        <span className="truncate">{vault.name}</span>
                        <span className="min-w-0 flex-1 truncate text-right font-mono text-2xs text-muted-foreground">{vault.path}</span>
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">None found.</span>
                  )}
                </div>
              </Row>
            </>
          ) : null}

          {section === 'notifications' ? (
            <>
              <Row title="Agent finished" description="System notification when an agent finishes its turn or needs input.">
                <Switch checked={settings.notifyOnAgentDone} onChange={(notifyOnAgentDone) => set({ notifyOnAgentDone })} />
              </Row>
              <Row title="Only when Relay is in the background">
                <Switch checked={settings.notifyOnlyWhenUnfocused} onChange={(notifyOnlyWhenUnfocused) => set({ notifyOnlyWhenUnfocused })} />
              </Row>
            </>
          ) : null}

          {section === 'shortcuts' ? (
            <div className="flex flex-col divide-y divide-border">
              {BINDINGS.map((binding) => (
                <div key={binding.id} className="flex h-9 items-center justify-between text-[13px]">
                  <span>{SHORTCUT_LABELS[binding.id] ?? binding.id}</span>
                  <Kbd>{binding.label}</Kbd>
                </div>
              ))}
              <div className="flex h-9 items-center justify-between text-[13px]">
                <span>Go to tab 1–9</span>
                <Kbd>Alt+1…9</Kbd>
              </div>
              <div className="flex h-9 items-center justify-between text-[13px]">
                <span>Find in terminal</span>
                <Kbd>Ctrl+F</Kbd>
              </div>
              <div className="flex h-9 items-center justify-between text-[13px]">
                <span>Newline in agent prompt</span>
                <Kbd>Shift+Enter</Kbd>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
