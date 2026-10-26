import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { resolveCommand } from './agents'
import { store } from './store'

export type ShellKind = 'powershell' | 'cmd' | 'posix'

export type SpawnRequest = {
  id: string
  cwd: string
  cols: number
  rows: number
  command?: string | null
  followupPrompt?: string | null
  env?: Record<string, string>
  inheritCursor?: boolean
}

type Session = {
  proc: pty.IPty
  buffer: string
  flushTimer: NodeJS.Timeout | null
  owner: WebContents
}

export function resolveShell(): { file: string; args: string[]; kind: ShellKind } {
  const configured = store().get().settings.shell.trim()
  if (process.platform === 'win32') {
    // PowerShell 7 (including the Microsoft Store install) before Windows PowerShell 5.1.
    const file = configured || resolveCommand('pwsh') || 'powershell.exe'
    const name = basename(file).toLowerCase()
    if (name.startsWith('cmd')) {
      return { file, args: [], kind: 'cmd' }
    }
    if (name.includes('bash') || name.includes('zsh') || name.includes('fish')) {
      return { file, args: ['--login'], kind: 'posix' }
    }
    return { file, args: ['-NoLogo'], kind: 'powershell' }
  }
  const file = configured || process.env.SHELL || '/bin/bash'
  return { file, args: ['-l'], kind: 'posix' }
}

/**
 * Runs `onQuiet` once output has been silent for `quietMs` after the first byte,
 * or after `maxMs` regardless. Shells and agent TUIs drop input typed before
 * their line editor is ready, so writes wait for the screen to settle.
 */
function whenOutputSettles(proc: pty.IPty, quietMs: number, maxMs: number, onQuiet: () => void): void {
  let done = false
  let quietTimer: NodeJS.Timeout | null = null
  const finish = (): void => {
    if (done) {
      return
    }
    done = true
    if (quietTimer) {
      clearTimeout(quietTimer)
    }
    clearTimeout(maxTimer)
    subscription.dispose()
    onQuiet()
  }
  const maxTimer = setTimeout(finish, maxMs)
  const subscription = proc.onData(() => {
    if (quietTimer) {
      clearTimeout(quietTimer)
    }
    quietTimer = setTimeout(finish, quietMs)
  })
}

class PtyManager {
  private sessions = new Map<string, Session>()

  spawn(owner: WebContents, request: SpawnRequest): { pid: number; shell: ShellKind } {
    this.kill(request.id)
    const shell = resolveShell()
    const cwd = existsSync(request.cwd) ? request.cwd : process.env.USERPROFILE || process.cwd()
    const proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(2, request.cols),
      rows: Math.max(2, request.rows),
      cwd,
      useConpty: true,
      // Why: the inbox ConPTY on Windows 10 repaints only its viewport on resize, dropping scrollback.
      useConptyDll: true,
      // Why: restored scrollback is already on screen; ConPTY must start below it instead of painting over it from row 0.
      conptyInheritCursor: Boolean(request.inheritCursor),
      env: {
        ...process.env,
        TERM_PROGRAM: 'relay',
        COLORTERM: 'truecolor',
        ...(request.env ?? {})
      } as Record<string, string>
    })
    const session: Session = { proc, buffer: '', flushTimer: null, owner }
    this.sessions.set(request.id, session)

    proc.onData((data) => {
      session.buffer += data
      if (!session.flushTimer) {
        session.flushTimer = setTimeout(() => this.flush(request.id), 8)
      }
    })
    proc.onExit(({ exitCode }) => {
      this.flush(request.id)
      if (this.sessions.get(request.id) === session) {
        this.sessions.delete(request.id)
      }
      if (!owner.isDestroyed()) {
        owner.send('pty:exit', request.id, exitCode)
      }
    })

    if (request.command) {
      const command = request.command
      whenOutputSettles(proc, 250, 4000, () => {
        proc.write(`${command}\r`)
        if (request.followupPrompt) {
          const prompt = request.followupPrompt
          // Why: stdin-mode agents only accept a prompt once their own composer is drawn.
          setTimeout(() => {
            whenOutputSettles(proc, 1200, 20000, () => {
              proc.write(`\x1b[200~${prompt}\x1b[201~`)
              setTimeout(() => proc.write('\r'), 150)
            })
          }, 500)
        }
      })
    }
    return { pid: proc.pid, shell: shell.kind }
  }

  private flush(id: string): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }
    session.flushTimer = null
    if (!session.buffer) {
      return
    }
    const data = session.buffer
    session.buffer = ''
    if (!session.owner.isDestroyed()) {
      session.owner.send('pty:data', id, data)
    }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }
    try {
      session.proc.resize(Math.max(2, cols), Math.max(2, rows))
    } catch {
      // The process can exit between the renderer's measure and this call.
    }
  }

  isAlive(id: string): boolean {
    return this.sessions.has(id)
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }
    this.sessions.delete(id)
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
    }
    try {
      session.proc.kill()
    } catch {
      // Already gone.
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id)
    }
  }
}

export const ptyManager = new PtyManager()
