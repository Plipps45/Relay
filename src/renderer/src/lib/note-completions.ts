import type { VaultNote } from '@shared/types'
import { monaco } from './monaco'

const vaults = new Map<string, () => VaultNote[]>()
let registered = false

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function notesFor(uri: monaco.Uri): VaultNote[] {
  const file = normalize(uri.fsPath)
  for (const [root, getNotes] of vaults) {
    if (file.startsWith(`${root}/`)) {
      return getNotes()
    }
  }
  return []
}

function register(): void {
  registered = true
  monaco.languages.registerCompletionItemProvider('markdown', {
    triggerCharacters: ['['],
    provideCompletionItems(model, position) {
      const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const match = /!?\[\[([^\]|#]*)$/.exec(before)
      if (!match) {
        return { suggestions: [] }
      }
      const after = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column + 2 })
      const range = new monaco.Range(position.lineNumber, position.column - match[1].length, position.lineNumber, position.column)
      const notes = notesFor(model.uri)
      // Duplicate names need their folder to stay unambiguous, as in Obsidian.
      const counts = new Map<string, number>()
      for (const note of notes) {
        counts.set(note.title.toLowerCase(), (counts.get(note.title.toLowerCase()) ?? 0) + 1)
      }
      const suggestions: monaco.languages.CompletionItem[] = []
      for (const note of notes) {
        const insert = (counts.get(note.title.toLowerCase()) ?? 0) > 1 ? note.path.replace(/\.md$/i, '') : note.title
        const close = after === ']]' ? '' : ']]'
        suggestions.push({
          label: note.title,
          kind: monaco.languages.CompletionItemKind.File,
          detail: note.path,
          insertText: `${insert}${close}`,
          filterText: `${note.title} ${note.aliases.join(' ')}`,
          sortText: String(Number.MAX_SAFE_INTEGER - Math.floor(note.mtime)).padStart(16, '0'),
          range
        })
        for (const alias of note.aliases) {
          suggestions.push({
            label: alias,
            kind: monaco.languages.CompletionItemKind.Reference,
            detail: `alias of ${note.title}`,
            insertText: `${insert}|${alias}${close}`,
            range
          })
        }
      }
      return { suggestions }
    }
  })
}

/** Offers the vault's notes after `[[` in markdown editors for files under `root`. */
export function registerVaultCompletions(root: string, getNotes: () => VaultNote[]): () => void {
  if (!registered) {
    register()
  }
  const key = normalize(root)
  vaults.set(key, getNotes)
  return () => {
    if (vaults.get(key) === getNotes) {
      vaults.delete(key)
    }
  }
}
