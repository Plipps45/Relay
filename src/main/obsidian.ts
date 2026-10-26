import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { ObsidianVault, SearchMatch, VaultIndex, VaultNote } from '@shared/types'
import { isNotePath, noteTitle, parseNote } from '@shared/obsidian'

// Obsidian keeps its config and trash in dot folders; neither holds notes.
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash'])
const MAX_FILES = 20_000

function obsidianConfigPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obsidian', 'obsidian.json')
}

/** Vaults Obsidian knows about, the one it last had open first. */
export async function listVaults(): Promise<ObsidianVault[]> {
  let config: { vaults?: Record<string, { path?: string; open?: boolean; ts?: number }> }
  try {
    config = JSON.parse(await readFile(obsidianConfigPath(), 'utf8'))
  } catch {
    return []
  }
  return Object.entries(config.vaults ?? {})
    .filter(([, vault]) => vault.path && existsSync(vault.path))
    .sort(([, a], [, b]) => Number(Boolean(b.open)) - Number(Boolean(a.open)) || (b.ts ?? 0) - (a.ts ?? 0))
    .map(([id, vault]) => ({ id, name: basename(vault.path!), path: vault.path!, open: Boolean(vault.open) }))
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) {
    return
  }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) {
      return
    }
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await walk(root, join(dir, entry.name), out)
      }
    } else if (entry.isFile()) {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
    }
  }
}

async function readDailyNotesConfig(root: string): Promise<VaultIndex['dailyNotes']> {
  try {
    const config = JSON.parse(await readFile(join(root, '.obsidian', 'daily-notes.json'), 'utf8'))
    return { folder: String(config.folder ?? '').replace(/^\/+|\/+$/g, ''), format: String(config.format ?? ''), template: String(config.template ?? '') }
  } catch {
    return { folder: '', format: '', template: '' }
  }
}

async function indexNote(root: string, path: string): Promise<VaultNote | null> {
  const full = join(root, path)
  try {
    const [info, text] = await Promise.all([stat(full), readFile(full, 'utf8')])
    const parsed = parseNote(text)
    return {
      path,
      title: noteTitle(path),
      mtime: info.mtimeMs,
      links: parsed.links,
      embeds: parsed.embeds,
      tags: parsed.tags,
      aliases: parsed.aliases
    }
  } catch {
    return null
  }
}

export async function indexVault(root: string): Promise<VaultIndex> {
  const paths: string[] = []
  await walk(root, root, paths)
  const notePaths = paths.filter(isNotePath)
  const notes: VaultNote[] = []
  // Bounded concurrency keeps large vaults from exhausting file handles.
  for (let i = 0; i < notePaths.length; i += 64) {
    const batch = await Promise.all(notePaths.slice(i, i + 64).map((path) => indexNote(root, path)))
    notes.push(...batch.filter((note): note is VaultNote => note !== null))
  }
  return { root, notes, files: paths.filter((path) => !isNotePath(path)), dailyNotes: await readDailyNotesConfig(root) }
}

/** Case-insensitive full-text search over the vault's notes. */
export async function searchVault(root: string, query: string, limit: number): Promise<SearchMatch[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return []
  }
  const paths: string[] = []
  await walk(root, root, paths)
  const matches: SearchMatch[] = []
  for (const path of paths.filter(isNotePath)) {
    let text: string
    try {
      text = await readFile(join(root, path), 'utf8')
    } catch {
      continue
    }
    const titleHit = noteTitle(path).toLowerCase().includes(needle)
    const lines = text.split(/\r?\n/)
    let hit = false
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({ filePath: path, line: i + 1, text: lines[i].trim().slice(0, 300) })
        hit = true
        if (matches.length >= limit) {
          return matches
        }
      }
    }
    if (titleHit && !hit) {
      matches.push({ filePath: path, line: 0, text: '' })
    }
  }
  return matches
}

/** Creates a note (and its folders) unless it already exists; returns the absolute path. */
export async function createNote(root: string, path: string, content: string): Promise<string> {
  const full = join(root, path)
  if (!relative(root, full) || relative(root, full).startsWith('..')) {
    throw new Error(`${path} is outside the vault.`)
  }
  await mkdir(dirname(full), { recursive: true })
  if (!existsSync(full)) {
    await writeFile(full, content, 'utf8')
  }
  return full
}

export async function readTemplate(root: string, template: string): Promise<string> {
  if (!template) {
    return ''
  }
  const path = /\.md$/i.test(template) ? template : `${template}.md`
  return readFile(join(root, path), 'utf8').catch(() => '')
}
