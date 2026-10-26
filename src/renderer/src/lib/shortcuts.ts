export const isMac = navigator.userAgent.includes('Mac')

export type ShortcutId =
  | 'newWorkspace'
  | 'newTerminal'
  | 'closeTab'
  | 'closePane'
  | 'quickOpen'
  | 'jumpWorkspace'
  | 'settings'
  | 'nextTab'
  | 'prevTab'
  | 'selectTab'
  | 'splitRight'
  | 'splitDown'
  | 'toggleLeftSidebar'
  | 'explorer'
  | 'sourceControl'
  | 'search'
  | 'nextWorkspace'
  | 'prevWorkspace'
  | 'focusNextPane'
  | 'focusPrevPane'
  | 'newBrowser'
  | 'notes'

type Binding = { id: ShortcutId; key: string; mod?: boolean; shift?: boolean; alt?: boolean; label: string }

const MOD = isMac ? '⌘' : 'Ctrl+'
const SHIFT = isMac ? '⇧' : 'Shift+'
const ALT = isMac ? '⌥' : 'Alt+'

function label(parts: { mod?: boolean; shift?: boolean; alt?: boolean }, key: string): string {
  return `${parts.mod ? MOD : ''}${parts.alt ? ALT : ''}${parts.shift ? SHIFT : ''}${key}`
}

const RAW: Omit<Binding, 'label'>[] = [
  { id: 'newWorkspace', key: 'n', mod: true },
  { id: 'newTerminal', key: 't', mod: true },
  { id: 'newBrowser', key: 'b', mod: true, shift: true },
  { id: 'notes', key: 'o', mod: true, shift: true },
  { id: 'closeTab', key: 'w', mod: true },
  { id: 'closePane', key: 'w', mod: true, shift: true },
  { id: 'quickOpen', key: 'p', mod: true },
  { id: 'jumpWorkspace', key: 'j', mod: true, shift: true },
  { id: 'settings', key: ',', mod: true },
  { id: 'nextTab', key: 'Tab', mod: true },
  { id: 'prevTab', key: 'Tab', mod: true, shift: true },
  { id: 'splitRight', key: 'd', mod: true, shift: true },
  { id: 'splitDown', key: 'd', alt: true, shift: true },
  { id: 'toggleLeftSidebar', key: 's', mod: true, shift: true },
  { id: 'explorer', key: 'e', mod: true, shift: true },
  { id: 'sourceControl', key: 'g', mod: true, shift: true },
  { id: 'search', key: 'f', mod: true, shift: true },
  { id: 'nextWorkspace', key: 'ArrowDown', mod: true, shift: true },
  { id: 'prevWorkspace', key: 'ArrowUp', mod: true, shift: true },
  { id: 'focusNextPane', key: ']', mod: true },
  { id: 'focusPrevPane', key: '[', mod: true }
]

const DISPLAY_KEYS: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑', Tab: 'Tab', ',': ',' }

export const BINDINGS: Binding[] = RAW.map((binding) => ({
  ...binding,
  label: label(binding, DISPLAY_KEYS[binding.key] ?? binding.key.toUpperCase())
}))

export function shortcutLabel(id: ShortcutId): string {
  return BINDINGS.find((b) => b.id === id)?.label ?? ''
}

export type ShortcutMatch = { id: ShortcutId; index?: number }

export function matchShortcut(event: KeyboardEvent): ShortcutMatch | null {
  const mod = isMac ? event.metaKey : event.ctrlKey
  // Why: Alt+digit selects tabs (the usual Linux/Windows binding); Ctrl+digit stays with terminal apps.
  if (event.altKey && !mod && !event.shiftKey && /^[1-9]$/.test(event.key)) {
    return { id: 'selectTab', index: Number(event.key) - 1 }
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  for (const binding of BINDINGS) {
    if (
      binding.key === key &&
      Boolean(binding.mod) === mod &&
      Boolean(binding.shift) === event.shiftKey &&
      Boolean(binding.alt) === event.altKey
    ) {
      return { id: binding.id }
    }
  }
  return null
}
