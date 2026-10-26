import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AGENTS } from '@shared/agents'
import type { AgentAvailability } from '@shared/types'

function searchDirs(): string[] {
  const separator = process.platform === 'win32' ? ';' : ':'
  const dirs = (process.env.PATH ?? '').split(separator).filter(Boolean)
  // Why: installers like Claude's put binaries here before the user's PATH is refreshed.
  const home = homedir()
  dirs.push(join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.cargo', 'bin'))
  if (process.platform === 'win32' && process.env.APPDATA) {
    dirs.push(join(process.env.APPDATA, 'npm'))
  }
  return [...new Set(dirs)]
}

function executableNames(command: string): string[] {
  if (process.platform !== 'win32') {
    return [command]
  }
  const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.PS1').split(';').filter(Boolean)
  return [...extensions.map((ext) => command + ext.toLowerCase()), command]
}

/**
 * existsSync stats the target, which fails with EACCES for Microsoft Store app
 * execution aliases (WindowsApps\pwsh.exe, winget links), so they'd look missing.
 */
function isPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

export function resolveCommand(command: string, dirs = searchDirs()): string | null {
  for (const dir of dirs) {
    for (const name of executableNames(command)) {
      const candidate = join(dir, name)
      if (isPresent(candidate)) {
        return candidate
      }
    }
  }
  return null
}

let cache: { at: number; result: AgentAvailability[] } | null = null

export function detectAgents(force = false): AgentAvailability[] {
  if (!force && cache && Date.now() - cache.at < 60_000) {
    return cache.result
  }
  const dirs = searchDirs()
  const result = AGENTS.map((agent) => {
    const commands = [agent.command, ...(agent.aliases ?? [])]
    const resolvedPath = commands.map((command) => resolveCommand(command, dirs)).find(Boolean) ?? null
    return { id: agent.id, installed: resolvedPath !== null, resolvedPath }
  })
  cache = { at: Date.now(), result }
  return result
}
