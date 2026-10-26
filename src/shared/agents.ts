/**
 * How the initial prompt reaches the agent. Each CLI accepts it differently,
 * so a prompt typed in the composer starts the run.
 */
export type PromptInjectionMode =
  | 'argv'
  | 'flag-prompt'
  | 'flag-prompt-interactive'
  | 'flag-interactive'
  | 'stdin-after-start'

export type AgentDefinition = {
  id: string
  label: string
  command: string
  aliases?: string[]
  launchCommand?: string
  promptMode: PromptInjectionMode
  argvSeparator?: string
  monogram: string
  color: string
  docsUrl: string
}

export const AGENTS: readonly AgentDefinition[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', promptMode: 'argv', monogram: 'C', color: '#d97757', docsUrl: 'https://docs.anthropic.com/claude/docs/claude-code' },
  { id: 'codex', label: 'Codex', command: 'codex', promptMode: 'argv', monogram: 'Cx', color: '#10a37f', docsUrl: 'https://github.com/openai/codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini', promptMode: 'flag-prompt-interactive', monogram: 'G', color: '#4285f4', docsUrl: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', promptMode: 'flag-prompt', monogram: 'Oc', color: '#a1a1aa', docsUrl: 'https://opencode.ai/docs/cli/' },
  { id: 'copilot', label: 'GitHub Copilot', command: 'copilot', promptMode: 'flag-interactive', monogram: 'Gh', color: '#8b5cf6', docsUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli' },
  { id: 'cursor', label: 'Cursor', command: 'cursor-agent', promptMode: 'argv', monogram: 'Cu', color: '#e4e4e7', docsUrl: 'https://cursor.com/cli' },
  { id: 'grok', label: 'Grok', command: 'grok', promptMode: 'argv', monogram: 'X', color: '#f4f4f5', docsUrl: 'https://x.ai/cli' },
  { id: 'amp', label: 'Amp', command: 'amp', promptMode: 'stdin-after-start', monogram: 'A', color: '#f43f5e', docsUrl: 'https://ampcode.com/manual#install' },
  { id: 'pi', label: 'Pi', command: 'pi', promptMode: 'argv', monogram: 'π', color: '#22c55e', docsUrl: 'https://pi.dev' },
  { id: 'droid', label: 'Droid', command: 'droid', promptMode: 'argv', monogram: 'D', color: '#f97316', docsUrl: 'https://docs.factory.ai/cli/getting-started/quickstart' },
  { id: 'aider', label: 'Aider', command: 'aider', promptMode: 'stdin-after-start', monogram: 'Ai', color: '#14b8a6', docsUrl: 'https://aider.chat' },
  { id: 'goose', label: 'Goose', command: 'goose', promptMode: 'stdin-after-start', monogram: 'Go', color: '#eab308', docsUrl: 'https://block.github.io/goose/docs/quickstart/' },
  { id: 'qwen-code', label: 'Qwen Code', command: 'qwen', promptMode: 'stdin-after-start', monogram: 'Q', color: '#6366f1', docsUrl: 'https://github.com/QwenLM/qwen-code' },
  { id: 'kimi', label: 'Kimi', command: 'kimi', aliases: ['kimi-code'], promptMode: 'stdin-after-start', monogram: 'K', color: '#38bdf8', docsUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html' },
  { id: 'kiro', label: 'Kiro', command: 'kiro-cli', launchCommand: 'kiro-cli chat --tui', promptMode: 'stdin-after-start', monogram: 'Ki', color: '#a855f7', docsUrl: 'https://kiro.dev/docs/cli/' },
  { id: 'cline', label: 'Cline', command: 'cline', promptMode: 'stdin-after-start', monogram: 'Cl', color: '#71717a', docsUrl: 'https://docs.cline.bot/cline-cli/overview' },
  { id: 'crush', label: 'Charm Crush', command: 'crush', promptMode: 'stdin-after-start', monogram: 'Cr', color: '#ec4899', docsUrl: 'https://github.com/charmbracelet/crush' },
  { id: 'aug', label: 'Auggie', command: 'auggie', promptMode: 'stdin-after-start', monogram: 'Au', color: '#84cc16', docsUrl: 'https://docs.augmentcode.com/cli/overview' },
  { id: 'kilo', label: 'Kilocode', command: 'kilo', promptMode: 'stdin-after-start', monogram: 'Kc', color: '#facc15', docsUrl: 'https://kilo.ai/docs/cli' },
  { id: 'mistral-vibe', label: 'Mistral Vibe', command: 'vibe', aliases: ['mistral-vibe'], promptMode: 'stdin-after-start', monogram: 'M', color: '#fb923c', docsUrl: 'https://github.com/mistralai/mistral-vibe' },
  { id: 'devin', label: 'Devin', command: 'devin', promptMode: 'argv', argvSeparator: '--', monogram: 'Dv', color: '#2dd4bf', docsUrl: 'https://devin.ai/cli' },
  { id: 'continue', label: 'Continue', command: 'cn', promptMode: 'stdin-after-start', monogram: 'Cn', color: '#e879f9', docsUrl: 'https://docs.continue.dev/guides/cli' },
  { id: 'codebuff', label: 'Codebuff', command: 'codebuff', promptMode: 'stdin-after-start', monogram: 'Cb', color: '#4ade80', docsUrl: 'https://www.codebuff.com/docs/help/quick-start' },
  { id: 'rovo', label: 'Rovo Dev', command: 'acli', launchCommand: 'acli rovodev run', promptMode: 'stdin-after-start', monogram: 'R', color: '#60a5fa', docsUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/' }
]

export function findAgent(id: string | null | undefined): AgentDefinition | undefined {
  return id ? AGENTS.find((agent) => agent.id === id) : undefined
}

/** Quote one argument for the target shell; prompts often hold quotes, `$` and newlines. */
export function quoteShellArg(value: string, shell: 'powershell' | 'cmd' | 'posix'): string {
  if (shell === 'powershell') {
    return `'${value.replace(/'/g, "''")}'`
  }
  if (shell === 'cmd') {
    return `"${value.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type AgentLaunchPlan = {
  command: string
  followupPrompt: string | null
}

export function buildAgentLaunchPlan(
  agent: AgentDefinition,
  prompt: string,
  shell: 'powershell' | 'cmd' | 'posix',
  commandOverride?: string
): AgentLaunchPlan {
  const base = commandOverride?.trim() || agent.launchCommand || agent.command
  const trimmed = prompt.trim()
  if (!trimmed) {
    return { command: base, followupPrompt: null }
  }
  const quoted = quoteShellArg(trimmed, shell)
  switch (agent.promptMode) {
    case 'argv':
      return {
        command: `${base}${agent.argvSeparator ? ` ${agent.argvSeparator}` : ''} ${quoted}`,
        followupPrompt: null
      }
    case 'flag-prompt':
      return { command: `${base} --prompt ${quoted}`, followupPrompt: null }
    case 'flag-prompt-interactive':
      return { command: `${base} --prompt-interactive ${quoted}`, followupPrompt: null }
    case 'flag-interactive':
      return { command: `${base} -i ${quoted}`, followupPrompt: null }
    case 'stdin-after-start':
      return { command: base, followupPrompt: trimmed }
  }
}
