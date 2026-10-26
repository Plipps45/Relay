import type { ReactNode } from 'react'
import { findAgent } from '@shared/agents'
import type { AgentStatus, WorkspaceStatus } from '@shared/types'
import { cn } from './ui'

export const WORKSPACE_STATUSES: { id: WorkspaceStatus; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
]

export function statusLabel(status: WorkspaceStatus): string {
  return WORKSPACE_STATUSES.find((s) => s.id === status)?.label ?? status
}

/** Conductor-style status glyphs: empty ring, half-filled ring, review ring, filled check. */
export function WorkspaceStatusIcon({ status, className }: { status: WorkspaceStatus; className?: string }): ReactNode {
  const base = cn('size-3.5 shrink-0', className)
  if (status === 'todo') {
    return (
      <svg viewBox="0 0 16 16" className={cn(base, 'text-muted-foreground')} aria-label="Todo">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />
      </svg>
    )
  }
  if (status === 'in-progress') {
    return (
      <svg viewBox="0 0 16 16" className={cn(base, 'text-status-progress')} aria-label="In progress">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4 A4 4 0 0 1 8 12 Z" fill="currentColor" />
      </svg>
    )
  }
  if (status === 'in-review') {
    return (
      <svg viewBox="0 0 16 16" className={cn(base, 'text-status-review')} aria-label="In review">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4 A4 4 0 1 1 4 8 L8 8 Z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" className={cn(base, 'text-status-done')} aria-label="Done">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5 8.2 7 10.2 11 6" fill="none" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AgentMonogram({ agentId, size = 16, className }: { agentId: string | null | undefined; size?: number; className?: string }): ReactNode {
  const agent = findAgent(agentId)
  const label = agent?.monogram ?? '>_'
  return (
    <span
      title={agent?.label ?? 'Terminal'}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[4px] font-mono font-semibold leading-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: label.length > 1 ? size * 0.42 : size * 0.6,
        color: agent ? agent.color : 'var(--muted-foreground)',
        background: agent ? `color-mix(in srgb, ${agent.color} 16%, transparent)` : 'var(--muted)'
      }}
    >
      {label}
    </span>
  )
}

/** Working spins (yellow), waiting on the user is orange, a finished unseen turn is a blue dot. */
export function AgentStateDot({ status, unread, className }: { status: AgentStatus | null; unread?: boolean; className?: string }): ReactNode {
  if (status === 'working') {
    return (
      <svg viewBox="0 0 16 16" className={cn('size-3 shrink-0 animate-spin text-agent-working', className)} aria-label="Working">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (status === 'permission') {
    return <span className={cn('size-2 shrink-0 rounded-full bg-agent-question animate-relay-pulse', className)} aria-label="Needs input" />
  }
  if (unread) {
    return <span className={cn('size-2 shrink-0 rounded-full bg-blue-500', className)} aria-label="Unread" />
  }
  if (status === 'idle') {
    return <span className={cn('size-2 shrink-0 rounded-full bg-status-success/70', className)} aria-label="Idle" />
  }
  return null
}

export function ProjectBadge({ name, color, className }: { name: string; color: string; className?: string }): ReactNode {
  return (
    <span
      className={cn('inline-flex h-4 max-w-[110px] shrink-0 items-center gap-1 rounded px-1 text-3xs font-semibold', className)}
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color: 'var(--foreground)' }}
    >
      <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  )
}

export function GitStatusLetter({ code }: { code: string }): ReactNode {
  const map: Record<string, { letter: string; color: string }> = {
    M: { letter: 'M', color: 'text-git-modified' },
    A: { letter: 'A', color: 'text-git-added' },
    D: { letter: 'D', color: 'text-git-deleted' },
    R: { letter: 'R', color: 'text-git-renamed' },
    C: { letter: 'C', color: 'text-git-renamed' },
    U: { letter: 'U', color: 'text-git-untracked' },
    '?': { letter: 'U', color: 'text-git-untracked' },
    T: { letter: 'T', color: 'text-git-modified' }
  }
  const entry = map[code] ?? { letter: code, color: 'text-muted-foreground' }
  return <span className={cn('w-3 shrink-0 text-center font-mono text-2xs font-semibold', entry.color)}>{entry.letter}</span>
}
