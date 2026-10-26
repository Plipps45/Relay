import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { shell, type WebContents } from 'electron'
import type { DirEntry, SearchMatch } from '@shared/types'
import { git, isGitRepo } from './git'

const HIDDEN_DIRS = new Set(['.git'])
const WALK_SKIP = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', 'target', '.venv'])
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp'
}
const MAX_TEXT_BYTES = 8 * 1024 * 1024

export async function readDir(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((entry) => !HIDDEN_DIRS.has(entry.name))
    .map((entry) => ({ name: entry.name, path: join(path, entry.name), isDirectory: entry.isDirectory() }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export type FileContent =
  | { kind: 'text'; content: string; size: number }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }

export async function readFileContent(path: string): Promise<FileContent> {
  const info = await stat(path)
  const imageType = IMAGE_TYPES[extname(path).toLowerCase()]
  if (imageType) {
    const data = await readFile(path)
    return { kind: 'image', dataUrl: `data:${imageType};base64,${data.toString('base64')}`, size: info.size }
  }
  if (info.size > MAX_TEXT_BYTES) {
    return { kind: 'too-large', size: info.size }
  }
  const data = await readFile(path)
  if (data.subarray(0, 8000).includes(0)) {
    return { kind: 'binary', size: info.size }
  }
  return { kind: 'text', content: data.toString('utf8'), size: info.size }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
}

export async function createEntry(path: string, directory: boolean): Promise<void> {
  if (directory) {
    await mkdir(path, { recursive: true })
  } else {
    await writeFile(path, '', { flag: 'wx' })
  }
}

export async function renameEntry(from: string, to: string): Promise<void> {
  await rename(from, to)
}

export async function trashEntry(path: string): Promise<void> {
  await shell.trashItem(path)
}

async function walk(root: string, dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) {
    return
  }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) {
      return
    }
    if (entry.isDirectory()) {
      if (!WALK_SKIP.has(entry.name)) {
        await walk(root, join(dir, entry.name), out, limit)
      }
    } else {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
    }
  }
}

/** Relative paths of every file, honoring .gitignore when the root is a repo. */
export async function listFiles(root: string): Promise<string[]> {
  if (await isGitRepo(root)) {
    const out = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    return [...new Set(out.split('\0').filter(Boolean))]
  }
  const files: string[] = []
  await walk(root, root, files, 50_000)
  return files
}

export type SearchOptions = { caseSensitive: boolean; regex: boolean; limit: number }

export async function searchText(root: string, query: string, options: SearchOptions): Promise<SearchMatch[]> {
  if (!query) {
    return []
  }
  if (await isGitRepo(root)) {
    const args = ['grep', '-n', '-I', '--untracked', '--no-color', '--full-name']
    if (!options.caseSensitive) {
      args.push('-i')
    }
    args.push(options.regex ? '-E' : '-F', '-e', query)
    let out = ''
    try {
      out = await git(root, args)
    } catch {
      // git grep exits 1 when nothing matches.
      return []
    }
    const matches: SearchMatch[] = []
    for (const line of out.split(/\r?\n/)) {
      const match = /^(.*?):(\d+):(.*)$/.exec(line)
      if (match) {
        matches.push({ filePath: match[1], line: Number(match[2]), text: match[3].slice(0, 400) })
        if (matches.length >= options.limit) {
          break
        }
      }
    }
    return matches
  }
  const files = await listFiles(root)
  const pattern = options.regex
    ? new RegExp(query, options.caseSensitive ? '' : 'i')
    : null
  const needle = options.caseSensitive ? query : query.toLowerCase()
  const matches: SearchMatch[] = []
  for (const file of files) {
    const content = await readFileContent(join(root, file)).catch(() => null)
    if (!content || content.kind !== 'text') {
      continue
    }
    const lines = content.content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const hit = pattern ? pattern.test(line) : (options.caseSensitive ? line : line.toLowerCase()).includes(needle)
      if (hit) {
        matches.push({ filePath: file, line: i + 1, text: line.slice(0, 400) })
        if (matches.length >= options.limit) {
          return matches
        }
      }
    }
  }
  return matches
}

/** One recursive watcher per open workspace; drives explorer and git status refreshes. */
class WorkspaceWatchers {
  private watchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null; paths: Set<string> }>()

  watch(owner: WebContents, workspaceId: string, root: string): void {
    if (this.watchers.has(workspaceId)) {
      return
    }
    let watcher: FSWatcher
    try {
      watcher = watch(root, { recursive: true })
    } catch {
      return
    }
    const entry = { watcher, timer: null as NodeJS.Timeout | null, paths: new Set<string>() }
    watcher.on('change', (_event, filename) => {
      const name = String(filename ?? '')
      if (name.includes(`node_modules${sep}`) || name.startsWith(`.git${sep}objects`)) {
        return
      }
      entry.paths.add(name)
      if (!entry.timer) {
        entry.timer = setTimeout(() => {
          entry.timer = null
          const paths = [...entry.paths]
          entry.paths.clear()
          if (!owner.isDestroyed()) {
            owner.send('fs:changed', workspaceId, paths)
          }
        }, 300)
      }
    })
    watcher.on('error', () => this.unwatch(workspaceId))
    this.watchers.set(workspaceId, entry)
  }

  unwatch(workspaceId: string): void {
    const entry = this.watchers.get(workspaceId)
    if (entry) {
      entry.watcher.close()
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
      this.watchers.delete(workspaceId)
    }
  }

  closeAll(): void {
    for (const id of [...this.watchers.keys()]) {
      this.unwatch(id)
    }
  }
}

export const workspaceWatchers = new WorkspaceWatchers()
