import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Columns2, Rows2, X } from 'lucide-react'
import type { SplitNode, TabSession } from '@shared/types'
import { useStore } from '@/store/app-store'
import { setSplitSizes } from '@/lib/split-layout'
import { attachTerminal, focusTerminal, onTerminalSearchRequest, terminalSearch } from '@/lib/terminal-registry'
import { AgentMonogram, AgentStateDot } from './badges'
import { IconButton, cn } from './ui'

type TerminalTabSession = Extract<TabSession, { kind: 'terminal' }>

export function TerminalTab({ workspaceId, tab, visible }: { workspaceId: string; tab: TerminalTabSession; visible: boolean }): ReactNode {
  const activePane = useStore((s) => s.activePaneByTab[tab.id])
  const updateTab = useStore((s) => s.updateTab)
  const multi = tab.layout.type === 'split'

  useEffect(() => {
    if (visible && activePane) {
      const id = requestAnimationFrame(() => focusTerminal(activePane))
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [visible, activePane])

  return (
    <div className="h-full w-full bg-[var(--terminal-background)]">
      <SplitView
        node={tab.layout}
        path={[]}
        render={(paneId) => (
          <TerminalPane key={paneId} workspaceId={workspaceId} tab={tab} paneId={paneId} active={!multi || activePane === paneId} showHeader={multi} />
        )}
        onResize={(path, sizes) => updateTab(workspaceId, tab.id, { layout: setSplitSizes(tab.layout, path, sizes) })}
      />
    </div>
  )
}

function SplitView({
  node,
  path,
  render,
  onResize
}: {
  node: SplitNode
  path: number[]
  render: (paneId: string) => ReactNode
  onResize: (path: number[], sizes: number[]) => void
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  if (node.type === 'pane') {
    return <>{render(node.paneId)}</>
  }
  const horizontal = node.direction === 'row'

  const startDrag = (index: number, event: React.MouseEvent): void => {
    event.preventDefault()
    const container = containerRef.current
    if (!container) {
      return
    }
    const rect = container.getBoundingClientRect()
    const total = horizontal ? rect.width : rect.height
    const startPos = horizontal ? event.clientX : event.clientY
    const startSizes = [...node.sizes]
    const onMove = (move: MouseEvent): void => {
      const delta = ((horizontal ? move.clientX : move.clientY) - startPos) / total
      const pair = startSizes[index] + startSizes[index + 1]
      const first = Math.min(pair - 0.06, Math.max(0.06, startSizes[index] + delta))
      const sizes = [...startSizes]
      sizes[index] = first
      sizes[index + 1] = pair - first
      onResize(path, sizes)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={containerRef} className={cn('flex h-full w-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, index) => (
        <div key={child.type === 'pane' ? child.paneId : `split-${index}`} className="flex min-h-0 min-w-0" style={{ flex: `${node.sizes[index]} 1 0` }}>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <SplitView node={child} path={[...path, index]} render={render} onResize={onResize} />
          </div>
          {index < node.children.length - 1 ? (
            <div
              role="separator"
              onMouseDown={(event) => startDrag(index, event)}
              className={cn(
                'shrink-0 bg-split-divider/60 transition-colors hover:bg-split-divider',
                horizontal ? 'w-px cursor-col-resize px-px' : 'h-px cursor-row-resize py-px'
              )}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function TerminalPane({
  workspaceId,
  tab,
  paneId,
  active,
  showHeader
}: {
  workspaceId: string
  tab: TerminalTabSession
  paneId: string
  active: boolean
  showHeader: boolean
}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtime = useStore((s) => s.paneRuntime[paneId])
  const setActivePane = useStore((s) => s.setActivePane)
  const closePane = useStore((s) => s.closePane)
  const splitActivePane = useStore((s) => s.splitActivePane)
  const [searchOpen, setSearchOpen] = useState(false)
  const pane = tab.panes.find((p) => p.id === paneId)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !pane) {
      return undefined
    }
    return attachTerminal({ paneId, workspaceId, tabId: tab.id, cwd: pane.cwd, scrollback: pane.scrollback }, host)
    // Why: the terminal instance outlives this component; only re-attach when the pane identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, workspaceId, tab.id])

  useEffect(() => onTerminalSearchRequest(paneId, () => setSearchOpen(true)), [paneId])

  return (
    <div
      className={cn('relative flex h-full w-full min-w-0 flex-col', !active && 'pane-inactive')}
      onMouseDown={() => setActivePane(tab.id, paneId)}
      onFocus={() => setActivePane(tab.id, paneId)}
    >
      {showHeader ? (
        <div className={cn('flex h-6 shrink-0 items-center gap-1.5 border-b border-border px-2 text-2xs', active ? 'text-foreground' : 'text-muted-foreground')}>
          {runtime?.agentId ? <AgentMonogram agentId={runtime.agentId} size={13} /> : null}
          <AgentStateDot status={runtime?.status ?? null} className="size-2.5" />
          <span className="min-w-0 flex-1 truncate">{runtime?.title || 'Terminal'}</span>
          <button type="button" title="Split right" className="rounded p-0.5 hover:bg-accent" onClick={() => splitActivePane(workspaceId, 'row')}>
            <Columns2 className="size-3" />
          </button>
          <button type="button" title="Split down" className="rounded p-0.5 hover:bg-accent" onClick={() => splitActivePane(workspaceId, 'column')}>
            <Rows2 className="size-3" />
          </button>
          <button type="button" title="Close pane" className="rounded p-0.5 hover:bg-accent" onClick={() => closePane(workspaceId, tab.id, paneId)}>
            <X className="size-3" />
          </button>
        </div>
      ) : null}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
      {searchOpen ? <TerminalSearchBar paneId={paneId} onClose={() => setSearchOpen(false)} /> : null}
    </div>
  )
}

function TerminalSearchBar({ paneId, onClose }: { paneId: string; onClose: () => void }): ReactNode {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ index: number; count: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = terminalSearch(paneId)

  useEffect(() => {
    inputRef.current?.focus()
    const subscription = search?.onDidChangeResults((r) => setResult({ index: r.resultIndex, count: r.resultCount }))
    return () => {
      subscription?.dispose()
      search?.clearDecorations()
    }
  }, [search])

  const decorations = {
    matchBackground: '#facc1555',
    activeMatchBackground: '#fb923c',
    matchOverviewRuler: '#facc15',
    activeMatchColorOverviewRuler: '#fb923c'
  }
  const find = (forward: boolean, incremental = false): void => {
    if (!search || !query) {
      return
    }
    if (forward) {
      search.findNext(query, { incremental, decorations })
    } else {
      search.findPrevious(query, { decorations })
    }
  }

  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-floating">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (search && e.target.value) {
            search.findNext(e.target.value, { incremental: true, decorations })
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            find(!e.shiftKey)
          } else if (e.key === 'Escape') {
            onClose()
            focusTerminal(paneId)
          }
        }}
        placeholder="Find"
        className="h-6 w-48 rounded bg-transparent px-1.5 text-xs outline-none"
      />
      <span className="w-14 text-center text-2xs text-muted-foreground">
        {result && query ? (result.count ? `${result.index + 1}/${result.count}` : 'No results') : ''}
      </span>
      <IconButton label="Previous match" className="size-6" onClick={() => find(false)}>
        <ArrowUp className="size-3.5" />
      </IconButton>
      <IconButton label="Next match" className="size-6" onClick={() => find(true)}>
        <ArrowDown className="size-3.5" />
      </IconButton>
      <IconButton
        label="Close"
        className="size-6"
        onClick={() => {
          onClose()
          focusTerminal(paneId)
        }}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
