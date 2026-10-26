import { useEffect, useState, type ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { formatResetIn, formatTokens, type ClaudeUsage, type PlanWindow, type TokenTotals } from '@shared/claude-usage'
import { cn } from './ui'

// Reading the logs and the /usage endpoint costs no model tokens; the interval only bounds disk reads.
const USAGE_POLL_MS = 60_000

function breakdown(label: string, tokens: TokenTotals): string {
  return `${label}: ${tokens.total.toLocaleString()} tokens
  input ${tokens.input.toLocaleString()} · output ${tokens.output.toLocaleString()}
  cache write ${tokens.cacheWrite.toLocaleString()} · cache read ${tokens.cacheRead.toLocaleString()}`
}

function LimitBar({ label, window, now }: { label: string; window: PlanWindow; now: number }): ReactNode {
  const percent = Math.min(100, Math.max(0, Math.round(window.utilization)))
  const resetIn = formatResetIn(window.resetsAt, now)
  return (
    <div
      className="flex items-center gap-2 text-2xs"
      title={window.resetsAt ? `${label}: ${percent}% used, resets ${new Date(window.resetsAt).toLocaleString()}` : undefined}
    >
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sidebar-accent">
        <div
          className={cn('h-full rounded-full', percent >= 90 ? 'bg-destructive' : percent >= 70 ? 'bg-status-warning' : 'bg-status-success')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums">{percent}%</span>
      <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{resetIn}</span>
    </div>
  )
}

export function UsageMeter(): ReactNode {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') {
        return
      }
      window.relay.usage
        .get()
        .then((next) => !cancelled && setUsage(next))
        .catch(() => undefined)
    }
    refresh()
    const interval = setInterval(refresh, USAGE_POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  if (!usage) {
    return null
  }
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="size-3" />
        Claude usage
        {usage.plan ? <span className="normal-case opacity-70">· {usage.plan}</span> : null}
      </div>
      {usage.session ? <LimitBar label="Session" window={usage.session} now={usage.updatedAt} /> : null}
      {usage.week ? <LimitBar label="Week" window={usage.week} now={usage.updatedAt} /> : null}
      <div className="flex items-center justify-between text-2xs text-muted-foreground tabular-nums">
        <span title={breakdown('Current 5-hour window', usage.sessionTokens)}>
          Session <span className="text-foreground">{formatTokens(usage.sessionTokens.total)}</span>
        </span>
        <span title={breakdown('Today', usage.todayTokens)}>
          Today <span className="text-foreground">{formatTokens(usage.todayTokens.total)}</span> tokens
        </span>
      </div>
    </div>
  )
}
