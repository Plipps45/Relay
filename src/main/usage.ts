import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { parseUsageLine, sumTokens, type ClaudeUsage, type PlanWindow, type UsageEntry } from '@shared/claude-usage'

/*
 * Claude usage for the sidebar meter. Nothing here talks to a model, so it
 * costs no tokens:
 * - token counts come from Claude Code's own session logs, read
 *   incrementally (only bytes appended since the last poll);
 * - plan limits come from the endpoint behind Claude Code's /usage, called
 *   at most every few minutes with the login Claude Code already stored.
 *   The token is never refreshed here, since that would sign Claude Code out.
 */

const DAY = 86_400_000
const FIVE_HOURS = 5 * 3_600_000
const KEEP = 2 * DAY
const CHUNK = 4 * 1024 * 1024
const LIMITS_TTL = 5 * 60_000
const LIMITS_RETRY = 10 * 60_000

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

type FileCursor = { offset: number; rest: string }

const cursors = new Map<string, FileCursor>()
const entries = new Map<string, UsageEntry>()
let scanning: Promise<void> | null = null

async function readAppended(path: string, cursor: FileCursor, size: number): Promise<void> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK, size - cursor.offset))
    const decoder = new StringDecoder('utf8')
    while (cursor.offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - cursor.offset), cursor.offset)
      if (bytesRead === 0) {
        break
      }
      cursor.offset += bytesRead
      const lines = (cursor.rest + decoder.write(buffer.subarray(0, bytesRead))).split('\n')
      cursor.rest = lines.pop() ?? ''
      for (const line of lines) {
        const entry = parseUsageLine(line)
        if (entry && entry.ts >= Date.now() - KEEP) {
          entries.set(entry.key, entry)
        }
      }
    }
  } finally {
    await handle.close()
  }
}

async function scanLogs(): Promise<void> {
  const root = join(claudeDir(), 'projects')
  let names: string[]
  try {
    names = (await readdir(root, { recursive: true })).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return
  }
  const cutoff = Date.now() - KEEP
  for (const name of names) {
    const path = join(root, name)
    try {
      const info = await stat(path)
      let cursor = cursors.get(path)
      if (!cursor) {
        // Files untouched for days only contribute old entries; skip their history.
        cursor = { offset: info.mtimeMs < cutoff ? info.size : 0, rest: '' }
        cursors.set(path, cursor)
      } else if (info.size < cursor.offset) {
        cursor.offset = 0
        cursor.rest = ''
      }
      if (info.size > cursor.offset) {
        await readAppended(path, cursor, info.size)
      }
    } catch {
      cursors.delete(path)
    }
  }
  for (const [key, entry] of entries) {
    if (entry.ts < cutoff) {
      entries.delete(key)
    }
  }
}

type Limits = { plan: string | null; session: PlanWindow | null; week: PlanWindow | null }

let limits: Limits = { plan: null, session: null, week: null }
let limitsNextAt = 0

function planWindow(value: unknown): PlanWindow | null {
  const window = value as { utilization?: unknown; resets_at?: unknown } | null
  if (!window || typeof window.utilization !== 'number') {
    return null
  }
  const resetsAt = typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN
  return { utilization: window.utilization, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
}

async function refreshLimits(): Promise<void> {
  if (Date.now() < limitsNextAt) {
    return
  }
  limitsNextAt = Date.now() + LIMITS_RETRY
  try {
    const credentials = JSON.parse(await readFile(join(claudeDir(), '.credentials.json'), 'utf8'))
    const oauth = credentials.claudeAiOauth as { accessToken?: string; expiresAt?: number; subscriptionType?: string } | undefined
    limits.plan = oauth?.subscriptionType ?? null
    if (!oauth?.accessToken || (oauth.expiresAt ?? 0) < Date.now()) {
      return
    }
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      return
    }
    const body = (await response.json()) as Record<string, unknown>
    limits = { plan: limits.plan, session: planWindow(body.five_hour), week: planWindow(body.seven_day) }
    limitsNextAt = Date.now() + LIMITS_TTL
  } catch {
    // No login file or offline: the meter shows local token counts only.
  }
}

export async function getClaudeUsage(): Promise<ClaudeUsage> {
  scanning ??= Promise.all([scanLogs(), refreshLimits()])
    .then(() => undefined)
    .finally(() => {
      scanning = null
    })
  await scanning
  const now = Date.now()
  const today = new Date(now).setHours(0, 0, 0, 0)
  const sessionStart = limits.session?.resetsAt && limits.session.resetsAt > now ? limits.session.resetsAt - FIVE_HOURS : now - FIVE_HOURS
  return {
    ...limits,
    sessionTokens: sumTokens(entries.values(), sessionStart),
    todayTokens: sumTokens(entries.values(), today),
    updatedAt: now
  }
}
