/*
 * Minimal SKILL.md frontmatter handling. Skills only need top-level scalar
 * keys (name, description), so this reads plain, quoted, folded (>) and
 * literal (|) values without pulling in a YAML dependency.
 */

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function parseSkillFrontmatter(text: string): Record<string, string> {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) {
    return {}
  }
  const lines = match[1].split(/\r?\n/)
  const result: Record<string, string> = {}
  for (let i = 0; i < lines.length; i += 1) {
    const keyMatch = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!keyMatch) {
      continue
    }
    const [, key, rawValue] = keyMatch
    const value = rawValue.trim()
    // Continuation lines are the indented ones that follow the key.
    const body: string[] = []
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && /^\s+\S/.test(lines[i + 2] ?? '')))) {
      body.push(lines[i + 1].trim())
      i += 1
    }
    if (/^[|>][+-]?$/.test(value)) {
      result[key] = value.startsWith('|') ? body.join('\n') : body.filter(Boolean).join(' ')
    } else if (/^(['"]).*\1$/.test(value) && body.length === 0) {
      result[key] = value.startsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value.slice(1, -1).replace(/''/g, "'")
    } else if (value === '' && body.length > 0) {
      // A nested map (e.g. metadata:) rather than a scalar.
      continue
    } else {
      result[key] = [value, ...body].filter(Boolean).join(' ')
    }
  }
  return result
}

/** Set the frontmatter `name:`, adding a frontmatter block when the file has none. */
export function renameSkillFrontmatter(text: string, name: string): string {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) {
    return `---\nname: ${name}\n---\n\n${text}`
  }
  const block = match[1]
  const renamed = /^name:.*$/m.test(block) ? block.replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${block}`
  return text.replace(block, renamed)
}

/** Name for a project copy; it must differ from the global one, since a personal skill outranks a project skill of the same name. */
export function adaptedSkillName(name: string): string {
  return `${name}-local`
}
