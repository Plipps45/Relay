/*
 * Obsidian vault conventions: [[wikilinks]], ![[embeds]], #tags, YAML
 * properties and Obsidian's shortest-path link resolution. Pure functions so
 * the main process (indexing) and the renderer (preview) agree on them.
 */

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g
const MD_LINK_RE = /(!?)\[[^\]\n]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
// Obsidian tags: letters, digits, _, -, / (nesting); at least one non-digit.
const TAG_RE = /(^|[\s(,])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/

export type NoteHeading = { level: number; text: string; line: number }

export type ParsedNote = {
  links: string[]
  embeds: string[]
  tags: string[]
  aliases: string[]
  headings: NoteHeading[]
}

export type NoteProperty = { key: string; value: string | string[] }

export function noteTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  return name.replace(/\.md$/i, '')
}

export function isNotePath(path: string): boolean {
  return /\.md$/i.test(path)
}

export function splitFrontmatter(text: string): { frontmatter: string | null; body: string; bodyLine: number } {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) {
    return { frontmatter: null, body: text.replace(/^﻿/, ''), bodyLine: 0 }
  }
  return { frontmatter: match[1], body: text.slice(match[0].length), bodyLine: match[0].split('\n').length - 1 }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (/^(['"]).*\1$/.test(trimmed)) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Top-level YAML properties as Obsidian shows them: scalars and lists (flow or block). */
export function parseProperties(frontmatter: string | null): NoteProperty[] {
  if (!frontmatter) {
    return []
  }
  const lines = frontmatter.split(/\r?\n/)
  const result: NoteProperty[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([^\s:#][^:]*?):(?:\s+(.*))?$/.exec(lines[i])
    if (!match) {
      continue
    }
    const key = match[1].trim()
    const raw = (match[2] ?? '').trim()
    if (raw.startsWith('[') && raw.endsWith(']')) {
      result.push({ key, value: raw.slice(1, -1).split(',').map(unquote).filter(Boolean) })
      continue
    }
    if (raw === '') {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[i + 1].replace(/^\s*-\s+/, '')))
        i += 1
      }
      result.push({ key, value: items })
      continue
    }
    result.push({ key, value: unquote(raw) })
  }
  return result
}

/** Blanks out fenced and inline code so links/tags inside them are ignored; line count is preserved. */
export function maskCode(text: string): string {
  const lines = text.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(lines[i])?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null
      }
      lines[i] = ''
    } else if (marker) {
      fence = marker
      lines[i] = ''
    } else {
      lines[i] = lines[i].replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))
    }
  }
  return lines.join('\n')
}

/** `Note#Heading|Alias` → `Note`. Inside tables the pipe is escaped as `\|`. */
export function linkTarget(raw: string): string {
  return raw.replace(/\\\|/g, '|').split('|')[0].split('#')[0].trim()
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseNote(text: string): ParsedNote {
  const { frontmatter, body, bodyLine } = splitFrontmatter(text)
  const masked = maskCode(body)
  const links = new Set<string>()
  const embeds = new Set<string>()
  const tags = new Set<string>()
  const aliases: string[] = []

  for (const match of masked.matchAll(WIKILINK_RE)) {
    const target = linkTarget(match[2])
    if (target) {
      ;(match[1] ? embeds : links).add(target)
    }
  }
  for (const match of masked.matchAll(MD_LINK_RE)) {
    const href = match[2]
    if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('#')) {
      continue
    }
    const target = decode(href.split('#')[0])
    if (target) {
      ;(match[1] ? embeds : links).add(target)
    }
  }
  for (const match of masked.matchAll(TAG_RE)) {
    tags.add(match[2])
  }

  for (const property of parseProperties(frontmatter)) {
    const values = Array.isArray(property.value) ? property.value : property.value.split(/[,\s]+/)
    if (/^tags?$/i.test(property.key)) {
      for (const tag of values) {
        if (tag.replace(/^#/, '')) {
          tags.add(tag.replace(/^#/, ''))
        }
      }
    } else if (/^alias(es)?$/i.test(property.key)) {
      aliases.push(...(Array.isArray(property.value) ? property.value : [property.value]).filter(Boolean))
    }
  }

  const headings: NoteHeading[] = []
  masked.split('\n').forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: bodyLine + index + 1 })
    }
  })

  return { links: [...links], embeds: [...embeds], tags: [...tags], aliases, headings }
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') {
      out.pop()
    } else if (part && part !== '.') {
      out.push(part)
    }
  }
  return out.join('/')
}

export type LinkResolver = (target: string, fromPath: string) => string | null

/**
 * Obsidian resolves `[[Name]]` by file name anywhere in the vault, preferring
 * the source note's folder and then the shortest path; `[[dir/Name]]` matches a
 * path suffix. Targets without an extension mean `.md`.
 */
export function createResolver(paths: string[]): LinkResolver {
  const byPath = new Map<string, string>()
  const byName = new Map<string, string[]>()
  for (const path of paths) {
    const lower = path.toLowerCase()
    byPath.set(lower, path)
    const name = lower.split('/').pop() ?? lower
    const list = byName.get(name)
    if (list) {
      list.push(path)
    } else {
      byName.set(name, [path])
    }
  }
  const pick = (candidates: string[], fromDir: string): string =>
    [...candidates].sort(
      (a, b) =>
        Number(dirname(b).toLowerCase() === fromDir) - Number(dirname(a).toLowerCase() === fromDir) ||
        a.split('/').length - b.split('/').length ||
        a.localeCompare(b)
    )[0]

  return (target, fromPath) => {
    const clean = target.replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (!clean) {
      return null
    }
    const fromDir = dirname(fromPath).toLowerCase()
    const variants = /\.[a-z0-9]{1,5}$/i.test(clean) && !/\.md$/i.test(clean) ? [clean, `${clean}.md`] : [/\.md$/i.test(clean) ? clean : `${clean}.md`]
    for (const variant of variants) {
      const lower = variant.toLowerCase()
      const relative = normalize(fromDir ? `${fromDir}/${lower}` : lower)
      const exact = byPath.get(lower) ?? byPath.get(relative)
      if (exact) {
        return exact
      }
      const name = lower.split('/').pop() ?? lower
      const candidates = (byName.get(name) ?? []).filter((path) => !lower.includes('/') || path.toLowerCase().endsWith(`/${lower}`))
      if (candidates.length) {
        return pick(candidates, fromDir)
      }
    }
    return null
  }
}

/** Flips the `index`-th task checkbox (`- [ ]` / `- [x]`) outside code blocks. */
export function toggleTask(text: string, index: number): string {
  const lines = text.split('\n')
  const masked = maskCode(text).split('\n')
  let seen = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (!TASK_RE.test(masked[i])) {
      continue
    }
    if (seen === index) {
      lines[i] = lines[i].replace(TASK_RE, (_m, open: string, mark: string, close: string) => `${open}${mark === ' ' ? 'x' : ' '}${close}`)
      return lines.join('\n')
    }
    seen += 1
  }
  return text
}

/** Name for a new note that doesn't clash with an existing one: Untitled, Untitled 1, … */
export function uniqueNoteName(base: string, folder: string, paths: string[]): string {
  const taken = new Set(paths.map((p) => p.toLowerCase()))
  const prefix = folder ? `${folder}/` : ''
  for (let n = 0; ; n += 1) {
    const name = n === 0 ? base : `${base} ${n}`
    if (!taken.has(`${prefix}${name}.md`.toLowerCase())) {
      return `${prefix}${name}.md`
    }
  }
}

/** Subset of moment.js tokens that Obsidian daily-note formats commonly use. */
export function formatDailyNote(format: string, date: Date): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate())
  }
  return (format || 'YYYY-MM-DD').replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D/g, (match, literal: string | undefined) => literal ?? tokens[match])
}
