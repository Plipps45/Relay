import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { AGENTS, findAgent } from '@shared/agents'
import { cleanAgentTitle, createAgentStatusTracker, titleHasAgentName } from '@shared/agent-status'
import type { ShellKind } from '../../../preload/api-types'
import { useStore } from '@/store/app-store'
import { matchShortcut } from './shortcuts'
import { DARK_TERMINAL_THEME, LIGHT_TERMINAL_THEME } from './terminal-theme'

type Entry = {
  paneId: string
  workspaceId: string
  tabId: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  serialize: SerializeAddon
  element: HTMLDivElement
  spawned: boolean
  opened: boolean
  pendingData: string[]
  tracker: ReturnType<typeof createAgentStatusTracker>
  resizeObserver: ResizeObserver | null
  shell: ShellKind
}

const entries = new Map<string, Entry>()
const searchListeners = new Map<string, () => void>()
let listening = false
let darkMode = true
const MAX_SCROLLBACK_CHARS = 400_000

function ensureListeners(): void {
  if (listening) {
    return
  }
  listening = true
  window.relay.pty.onData((id, data) => {
    const entry = entries.get(id)
    if (!entry) {
      return
    }
    if (entry.opened) {
      entry.term.write(data)
    } else {
      entry.pendingData.push(data)
    }
  })
  window.relay.pty.onExit((id, exitCode) => {
    const entry = entries.get(id)
    if (!entry) {
      return
    }
    entry.spawned = false
    entry.term.write(`\r\n\x1b[2m[process exited with code ${exitCode} — press Enter to restart]\x1b[0m\r\n`)
    useStore.getState().setPaneRuntime(id, { status: null, exited: true })
  })
}

/** Agent identity from a title, e.g. "✳ Claude Code" → claude. */
function agentFromTitle(title: string): string | null {
  const lower = title.toLowerCase()
  for (const agent of AGENTS) {
    const names = [agent.command, agent.id, ...(agent.aliases ?? [])]
    if (names.some((name) => new RegExp(`(^|[^\\w./\\\\-])${name}(?![\\w./\\\\-])`, 'i').test(lower))) {
      return agent.id
    }
  }
  return null
}

function onTitle(entry: Entry, rawTitle: string): void {
  const store = useStore.getState()
  const { status, transition } = entry.tracker.handleTitle(rawTitle)
  const runtime = store.paneRuntime[entry.paneId]
  const detectedAgent = titleHasAgentName(rawTitle) ? agentFromTitle(rawTitle) : null
  const agentId = runtime?.agentId ?? detectedAgent
  const agent = findAgent(agentId)
  // Why: Windows shells set the title to their executable path, which says nothing useful.
  const isShellPath = /^[a-z]:\\.*\.exe$/i.test(rawTitle.trim()) || /^(administrator: )?(windows )?powershell$/i.test(rawTitle.trim())
  const title =
    agent && status !== null ? agent.label : isShellPath ? (runtime?.title ?? 'Terminal') : cleanAgentTitle(rawTitle)
  store.setPaneRuntime(entry.paneId, { status, title, agentId: status === null && transition?.kind === 'exited' ? runtime?.agentId ?? null : agentId })

  if (transition?.kind !== 'became-idle') {
    return
  }
  const workspace = store.workspaces.find((w) => w.id === entry.workspaceId)
  const isVisible = store.ui?.activeWorkspaceId === entry.workspaceId && store.windowFocused
  if (!isVisible) {
    store.markUnread(entry.workspaceId, true)
  }
  const name = agent?.label ?? 'Agent'
  const body =
    transition.status === 'permission' ? `${name} needs your input` : `${name} finished its turn`
  void window.relay.app.notify({
    title: workspace?.displayName ?? 'Relay',
    body,
    workspaceId: entry.workspaceId
  })
}

function quotePath(path: string, shell: ShellKind): string {
  if (!/[\s'"&()$`;]/.test(path)) {
    return path
  }
  return shell === 'posix' ? `'${path.replace(/'/g, `'\\''`)}'` : `"${path}"`
}

export type CreateTerminalOptions = {
  paneId: string
  workspaceId: string
  tabId: string
  cwd: string
  scrollback?: string
}

function create(options: CreateTerminalOptions): Entry {
  ensureListeners()
  const settings = useStore.getState().settings
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: settings?.terminalFontFamily,
    fontSize: settings?.terminalFontSize ?? 13,
    scrollback: settings?.terminalScrollback ?? 10000,
    cursorBlink: true,
    lineHeight: 1.15,
    theme: darkMode ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME,
    macOptionIsMeta: true,
    rightClickSelectsWord: false
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  const serialize = new SerializeAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(serialize)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(
    new WebLinksAddon((_event, uri) => {
      void window.relay.shell.openExternal(uri)
    })
  )

  const element = document.createElement('div')
  element.className = 'terminal-host h-full w-full'

  const entry: Entry = {
    ...options,
    term,
    fit,
    search,
    serialize,
    element,
    spawned: false,
    opened: false,
    pendingData: [],
    tracker: createAgentStatusTracker(),
    resizeObserver: null,
    shell: 'powershell'
  }

  term.onData((data) => {
    if (!entry.spawned) {
      if (data === '\r') {
        void spawn(entry)
      }
      return
    }
    window.relay.pty.write(entry.paneId, data)
  })
  term.onTitleChange((title) => onTitle(entry, title))
  term.onResize(({ cols, rows }) => {
    if (entry.spawned) {
      window.relay.pty.resize(entry.paneId, cols, rows)
    }
  })

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true
    }
    const ctrl = event.ctrlKey || event.metaKey
    if (ctrl && !event.shiftKey && event.key.toLowerCase() === 'c' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (ctrl && event.shiftKey && event.key.toLowerCase() === 'c') {
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
      }
      return false
    }
    if (ctrl && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void navigator.clipboard.readText().then((text) => text && term.paste(text))
      return false
    }
    if (ctrl && !event.shiftKey && event.key.toLowerCase() === 'f') {
      searchListeners.get(entry.paneId)?.()
      return false
    }
    // Why: agent TUIs (Claude Code, Codex) treat Alt+Enter as "insert newline" in their composer.
    if (event.key === 'Enter' && event.shiftKey && !ctrl) {
      if (entry.spawned) {
        window.relay.pty.write(entry.paneId, '\x1b\r')
      }
      return false
    }
    if (matchShortcut(event)) {
      return false
    }
    return true
  })

  element.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } else {
      void navigator.clipboard.readText().then((text) => text && term.paste(text))
    }
  })

  element.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  })
  element.addEventListener('drop', (event) => {
    event.preventDefault()
    const paths: string[] = []
    const internal = event.dataTransfer?.getData('application/x-relay-path')
    if (internal) {
      paths.push(internal)
    }
    for (const file of Array.from(event.dataTransfer?.files ?? [])) {
      const path = window.relay.fs.pathForFile(file)
      if (path) {
        paths.push(path)
      }
    }
    if (paths.length && entry.spawned) {
      window.relay.pty.write(entry.paneId, `${paths.map((p) => quotePath(p, entry.shell)).join(' ')} `)
      term.focus()
    }
  })

  if (options.scrollback) {
    entry.pendingData.push(options.scrollback, '\r\n\x1b[2m── session restored ──\x1b[0m\r\n')
  }
  entries.set(options.paneId, entry)
  return entry
}

async function spawn(entry: Entry): Promise<void> {
  if (entry.spawned) {
    return
  }
  entry.spawned = true
  const launch = useStore.getState().consumePendingLaunch(entry.paneId)
  const store = useStore.getState()
  store.setPaneRuntime(entry.paneId, { exited: false })
  const workspace = store.workspaces.find((w) => w.id === entry.workspaceId)
  const pane = (store.sessions[entry.workspaceId]?.tabs ?? [])
    .flatMap((t) => (t.kind === 'terminal' ? t.panes : []))
    .find((p) => p.id === entry.paneId)
  try {
    const result = await window.relay.pty.spawn({
      id: entry.paneId,
      cwd: pane?.cwd || workspace?.path || '',
      cols: entry.term.cols,
      rows: entry.term.rows,
      command: launch?.command ?? null,
      followupPrompt: launch?.followupPrompt ?? null,
      env: workspace
        ? { RELAY_WORKSPACE_PATH: workspace.path, RELAY_WORKSPACE_NAME: workspace.displayName }
        : undefined
    })
    entry.shell = result.shell
  } catch (error) {
    entry.spawned = false
    entry.term.write(`\r\n\x1b[31mFailed to start shell: ${String(error)}\x1b[0m\r\n`)
  }
}

export function attachTerminal(options: CreateTerminalOptions, host: HTMLElement): () => void {
  const entry = entries.get(options.paneId) ?? create(options)
  entry.tabId = options.tabId
  host.appendChild(entry.element)
  if (!entry.opened) {
    entry.term.open(entry.element)
    entry.opened = true
    for (const chunk of entry.pendingData.splice(0)) {
      entry.term.write(chunk)
    }
  }
  const refit = (): void => {
    if (entry.element.clientWidth > 0 && entry.element.clientHeight > 0) {
      try {
        entry.fit.fit()
      } catch {
        // Hidden hosts report zero size mid-layout.
      }
    }
  }
  requestAnimationFrame(() => {
    refit()
    void spawn(entry)
  })
  entry.resizeObserver?.disconnect()
  entry.resizeObserver = new ResizeObserver(() => refit())
  entry.resizeObserver.observe(entry.element)
  return () => {
    entry.resizeObserver?.disconnect()
    entry.resizeObserver = null
    if (entry.element.parentElement === host) {
      host.removeChild(entry.element)
    }
  }
}

export function focusTerminal(paneId: string): void {
  entries.get(paneId)?.term.focus()
}

export function disposeTerminal(paneId: string): void {
  const entry = entries.get(paneId)
  if (!entry) {
    return
  }
  entries.delete(paneId)
  entry.resizeObserver?.disconnect()
  window.relay.pty.kill(paneId)
  entry.term.dispose()
  entry.element.remove()
}

export function terminalSearch(paneId: string): SearchAddon | null {
  return entries.get(paneId)?.search ?? null
}

export function onTerminalSearchRequest(paneId: string, listener: () => void): () => void {
  searchListeners.set(paneId, listener)
  return () => {
    if (searchListeners.get(paneId) === listener) {
      searchListeners.delete(paneId)
    }
  }
}

/** Paste text into a pane's input without submitting, the way a user paste would. */
export function pasteIntoTerminal(paneId: string, text: string, submit = false): boolean {
  const entry = entries.get(paneId)
  if (!entry || !entry.spawned) {
    return false
  }
  window.relay.pty.write(paneId, `\x1b[200~${text}\x1b[201~`)
  if (submit) {
    setTimeout(() => window.relay.pty.write(paneId, '\r'), 120)
  }
  entry.term.focus()
  return true
}

export function clearTerminal(paneId: string): void {
  entries.get(paneId)?.term.clear()
}

export function hasTerminal(paneId: string): boolean {
  return entries.has(paneId)
}

export function setTerminalAppearance(dark: boolean, fontFamily?: string, fontSize?: number): void {
  darkMode = dark
  for (const entry of entries.values()) {
    entry.term.options.theme = dark ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME
    if (fontFamily) {
      entry.term.options.fontFamily = fontFamily
    }
    if (fontSize) {
      entry.term.options.fontSize = fontSize
    }
    try {
      entry.fit.fit()
    } catch {
      // Detached terminal; refits on next attach.
    }
  }
}

export function snapshotScrollback(): Record<string, string> {
  const snapshot: Record<string, string> = {}
  for (const [paneId, entry] of entries) {
    if (!entry.opened) {
      continue
    }
    try {
      const data = entry.serialize.serialize({ scrollback: 2000 })
      snapshot[paneId] = data.length > MAX_SCROLLBACK_CHARS ? data.slice(-MAX_SCROLLBACK_CHARS) : data
    } catch {
      // Skip panes the serializer cannot read.
    }
  }
  return snapshot
}
