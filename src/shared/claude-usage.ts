/*
 * Token usage as Claude Code records it in ~/.claude/projects/**\/*.jsonl,
 * read the same way ccusage does: one assistant message can span several
 * lines (one per content block) that repeat the same usage, so entries are
 * deduplicated by message id + request id.
 */

export type UsageEntry = {
  key: string
  ts: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export type TokenTotals = { input: number; output: number; cacheWrite: number; cacheRead: number; total: number }

export type PlanWindow = { utilization: number; resetsAt: number | null }

export type ClaudeUsage = {
  plan: string | null
  /** Plan limits from Claude's own usage endpoint; null when unavailable (API key users, expired login, offline). */
  session: PlanWindow | null
  week: PlanWindow | null
  /** Tokens since the current 5-hour window started (or the last 5 hours when the window is unknown). */
  sessionTokens: TokenTotals
  todayTokens: TokenTotals
  updatedAt: number
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function parseUsageLine(line: string): UsageEntry | null {
  // Cheap pre-filter: most lines are user turns and tool results.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) {
    return null
  }
  let record: { timestamp?: string; requestId?: string; message?: { id?: string; usage?: Record<string, unknown> } }
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  const usage = record.message?.usage
  const ts = record.timestamp ? Date.parse(record.timestamp) : NaN
  if (!usage || Number.isNaN(ts)) {
    return null
  }
  return {
    key: `${record.message?.id ?? ''}:${record.requestId ?? ''}`,
    ts,
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
    cacheRead: num(usage.cache_read_input_tokens)
  }
}

export function sumTokens(entries: Iterable<UsageEntry>, since: number): TokenTotals {
  const totals: TokenTotals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 }
  for (const entry of entries) {
    if (entry.ts >= since) {
      totals.input += entry.input
      totals.output += entry.output
      totals.cacheWrite += entry.cacheWrite
      totals.cacheRead += entry.cacheRead
    }
  }
  totals.total = totals.input + totals.output + totals.cacheWrite + totals.cacheRead
  return totals
}

export function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value)
  }
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k']
  ]
  const [size, unit] = units.find(([size]) => value >= size)!
  const scaled = value / size
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, '')}${unit}`
}

export function formatResetIn(resetsAt: number | null, now: number): string {
  if (resetsAt === null) {
    return ''
  }
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
