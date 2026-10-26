import { buildAgentLaunchPlan, findAgent } from '@shared/agents'
import { useStore } from '@/store/app-store'

let cachedShell: Promise<'powershell' | 'cmd' | 'posix'> | null = null

function shellKind(): Promise<'powershell' | 'cmd' | 'posix'> {
  cachedShell ??= window.relay.pty.shellKind()
  return cachedShell
}

export function resetShellKindCache(): void {
  cachedShell = null
}

/** Opens a terminal tab in the workspace and starts the agent CLI, optionally with a first prompt. */
export async function launchAgent(workspaceId: string, agentId: string, prompt = ''): Promise<void> {
  const agent = findAgent(agentId)
  const state = useStore.getState()
  if (!agent) {
    state.toast('error', `Unknown agent: ${agentId}`)
    return
  }
  const override = state.settings?.agentCommandOverrides[agent.id]
  const plan = buildAgentLaunchPlan(agent, prompt, await shellKind(), override)
  state.openTerminalTab(workspaceId, {
    agentId: agent.id,
    title: agent.label,
    command: plan.command,
    followupPrompt: plan.followupPrompt
  })
}

export async function runScriptInNewTab(workspaceId: string, title: string, script: string): Promise<void> {
  const shell = await shellKind()
  const separator = shell === 'cmd' ? ' & ' : shell === 'posix' ? ' && ' : ' ; '
  const command = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(separator)
  useStore.getState().openTerminalTab(workspaceId, { title, command })
}
