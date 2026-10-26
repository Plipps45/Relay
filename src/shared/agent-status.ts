import type { AgentStatus } from './types'

/*
 * Terminal-title based agent status. Agent CLIs animate their OSC window
 * title while they work (braille or quarter-circle spinners, Gemini glyphs) and settle on a
 * rest glyph or keyword when they are idle or waiting for the user.
 */

const CLAUDE_IDLE = '✳' // ✳
const GEMINI_WORKING = '✦' // ✦
const GEMINI_SILENT_WORKING = '⏲' // ⏲
const GEMINI_IDLE = '◇' // ◇
const GEMINI_PERMISSION = '✋' // ✋

const AGENT_NAMES = [
  'claude',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'opencode',
  'aider',
  'grok',
  'devin',
  'droid',
  'goose',
  'qwen',
  'kimi'
]

const EXE_SUFFIX = String.raw`(?:\.(?:exe|cmd|bat|ps1))`

// Why token boundaries: a cwd like "~/codex/ready" or "opencode-blinker" must not read as an agent.
const ANY_AGENT_NAME_RE = new RegExp(
  AGENT_NAMES.map((name) => `(?:^|[^\\w./\\\\-])${name}${EXE_SUFFIX}?(?![\\w./\\\\-])`).join('|'),
  'i'
)

const IDLE_KEYWORDS_RE = /(^|[^\w./\\-])(ready|idle|done)(?![\w-])/i
const WORKING_KEYWORDS_RE = /(^|[^\w./\\-])(working|thinking|running)(?![\w-])/i
const CLAUDE_MANAGEMENT_TITLE_RE = /^\s*(?:.*[\\/])?claude(?:\.(?:exe|cmd|bat|ps1))?\s+agents\s*$/i

export function containsSpinnerGlyph(title: string): boolean {
  for (const char of title) {
    const code = char.codePointAt(0) ?? 0
    if ((code >= 0x2800 && code <= 0x28ff) || (code >= 0x25d0 && code <= 0x25d3)) {
      return true
    }
  }
  return false
}

export function titleHasAgentName(title: string): boolean {
  return ANY_AGENT_NAME_RE.test(title)
}

export function detectAgentStatusFromTitle(title: string): AgentStatus | null {
  if (!title || CLAUDE_MANAGEMENT_TITLE_RE.test(title)) {
    return null
  }
  if (title.includes(GEMINI_PERMISSION)) {
    return 'permission'
  }
  if (title.includes(GEMINI_WORKING) || title.includes(GEMINI_SILENT_WORKING)) {
    return 'working'
  }
  if (title.includes(GEMINI_IDLE)) {
    return 'idle'
  }
  if (title.startsWith(`${CLAUDE_IDLE} `) || title === CLAUDE_IDLE) {
    return 'idle'
  }
  if (containsSpinnerGlyph(title)) {
    return 'working'
  }
  if (!titleHasAgentName(title)) {
    return null
  }
  const lower = title.toLowerCase()
  if (['action required', 'permission', 'waiting'].some((word) => lower.includes(word))) {
    return 'permission'
  }
  if (IDLE_KEYWORDS_RE.test(title)) {
    return 'idle'
  }
  if (WORKING_KEYWORDS_RE.test(title)) {
    return 'working'
  }
  if (title.startsWith('. ')) {
    return 'working'
  }
  return 'idle'
}

/** Strip spinner frames so a title reads the same across animation steps. */
export function cleanAgentTitle(title: string): string {
  const cleaned = title
    .replace(/[⠀-⣿◐-◓]/g, '')
    .replace(GEMINI_WORKING, '')
    .replace(GEMINI_SILENT_WORKING, '')
    .replace(CLAUDE_IDLE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || title
}

export type AgentStatusTransition =
  | { kind: 'became-working' }
  | { kind: 'became-idle'; status: Exclude<AgentStatus, 'working'> }
  | { kind: 'exited' }

/**
 * Tracks one pane's status across title changes and reports the edges the UI
 * cares about: a run starting, a run finishing (idle or waiting on the user),
 * and the agent leaving the terminal.
 */
export function createAgentStatusTracker(): {
  handleTitle: (title: string) => { status: AgentStatus | null; transition: AgentStatusTransition | null }
  current: () => AgentStatus | null
} {
  let last: AgentStatus | null = null
  return {
    handleTitle(title) {
      const next = detectAgentStatusFromTitle(title)
      let transition: AgentStatusTransition | null = null
      if (last === 'working' && next !== null && next !== 'working') {
        transition = { kind: 'became-idle', status: next }
      } else if (last !== 'working' && next === 'working') {
        transition = { kind: 'became-working' }
      } else if (last !== null && last !== 'working' && next === null) {
        transition = { kind: 'exited' }
      }
      // Why: while working, a transient non-agent title is usually a tool subprocess, not an exit.
      if (next !== null || last !== 'working') {
        last = next
      }
      return { status: last, transition }
    },
    current: () => last
  }
}
