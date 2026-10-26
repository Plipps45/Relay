import type { ReactNode } from 'react'

/** An R whose leg turns into a forward arrow: work handed on to the next agent. */
export function RelayLogo({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 26 V6.5 H17 a5.75 5.75 0 0 1 0 11.5 H9.5" />
        <path d="M15.5 18 L24 26.5" />
        <path d="M17.5 26.5 H24 V20" />
      </g>
    </svg>
  )
}
