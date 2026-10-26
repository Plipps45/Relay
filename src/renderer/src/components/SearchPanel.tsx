import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, Regex } from 'lucide-react'
import type { SearchMatch, Workspace } from '@shared/types'
import { useStore } from '@/store/app-store'
import { joinPath } from './DiffView'
import { FileIcon } from './FileIcon'
import { IconButton, Spinner } from './ui'

const LIMIT = 2000

export function SearchPanel({ workspace }: { workspace: Workspace }): ReactNode {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<SearchMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const openEditorTab = useStore((s) => s.openEditorTab)
  const focusToken = useStore((s) => s.searchFocusToken)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusToken])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return undefined
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      window.relay.fs
        .search(workspace.path, query, { caseSensitive, regex, limit: LIMIT })
        .then((matches) => {
          if (!cancelled) {
            setResults(matches)
          }
        })
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, caseSensitive, regex, workspace.path])

  const byFile = new Map<string, SearchMatch[]>()
  for (const match of results) {
    byFile.set(match.filePath, [...(byFile.get(match.filePath) ?? []), match])
  }

  const highlight = (text: string): ReactNode => {
    const trimmed = text.trimStart()
    try {
      const pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i')
      const match = pattern.exec(trimmed)
      if (!match || !match[0]) {
        return trimmed
      }
      return (
        <>
          {trimmed.slice(0, match.index)}
          <mark className="rounded-sm bg-yellow-400/40 text-foreground">{match[0]}</mark>
          {trimmed.slice(match.index + match[0].length)}
        </>
      )
    } catch {
      return trimmed
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <div className="flex h-8 items-center gap-0.5 rounded-md border border-input pr-1 pl-2 focus-within:border-ring">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in workspace"
            className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
          <IconButton label="Match case" className="size-6" active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>
            <CaseSensitive className="size-3.5" />
          </IconButton>
          <IconButton label="Use regular expression" className="size-6" active={regex} onClick={() => setRegex((v) => !v)}>
            <Regex className="size-3.5" />
          </IconButton>
        </div>
        <div className="mt-1.5 flex h-4 items-center gap-1.5 px-0.5 text-2xs text-muted-foreground">
          {loading ? <Spinner className="size-3" /> : null}
          {query && !loading ? `${results.length}${results.length >= LIMIT ? '+' : ''} results in ${byFile.size} files` : null}
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-3">
        {[...byFile.entries()].map(([file, matches]) => {
          const name = file.split('/').pop() ?? file
          return (
            <div key={file}>
              <button
                type="button"
                className="flex h-[22px] w-full items-center gap-1 px-2 text-left text-[13px] hover:bg-accent"
                onClick={() => setCollapsed((c) => ({ ...c, [file]: !c[file] }))}
              >
                {collapsed[file] ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                <FileIcon name={name} />
                <span className="truncate">{name}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{file.slice(0, file.length - name.length)}</span>
                <span className="rounded-full bg-muted px-1.5 text-3xs text-muted-foreground">{matches.length}</span>
              </button>
              {collapsed[file]
                ? null
                : matches.map((match) => (
                    <button
                      key={`${file}:${match.line}`}
                      type="button"
                      onClick={() => openEditorTab(workspace.id, joinPath(workspace.path, file), match.line)}
                      className="flex w-full items-baseline gap-2 py-0.5 pr-2 pl-9 text-left text-xs hover:bg-accent"
                    >
                      <span className="w-8 shrink-0 text-right font-mono text-3xs text-muted-foreground">{match.line}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-2xs">{highlight(match.text)}</span>
                    </button>
                  ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
