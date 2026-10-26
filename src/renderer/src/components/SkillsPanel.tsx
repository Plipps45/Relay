import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, CopyPlus, FolderOpen, Pencil, RefreshCw, Search, Trash2, TriangleAlert } from 'lucide-react'
import type { ProjectSkills, SkillInfo, SkillSource, Workspace } from '@shared/types'
import { adaptedSkillName } from '@shared/skill-frontmatter'
import { errorMessage, useStore } from '@/store/app-store'
import { FileIcon } from './FileIcon'
import { IconButton, Spinner, cn } from './ui'

const SECTIONS: { source: SkillSource; label: string; hint: string }[] = [
  { source: 'project', label: 'This project', hint: '.claude/skills in the repository' },
  { source: 'personal', label: 'Personal', hint: '~/.claude/skills — loaded in every project unless turned off here' },
  { source: 'plugin', label: 'Plugins', hint: 'Skills from installed Claude Code plugins (/plugin)' },
  { source: 'synced', label: 'claude.ai', hint: 'Synced from your claude.ai account to ~/.claude/skills/synced' }
]

function joinDir(dir: string, rel: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${dir}${sep}${rel.split('/').join(sep)}`
}

function SectionCheckbox({ skills, enabled, onChange }: { skills: SkillInfo[]; enabled: (s: SkillInfo) => boolean; onChange: (on: boolean) => void }): ReactNode {
  const on = skills.filter(enabled).length
  return (
    <input
      type="checkbox"
      aria-label="Toggle all"
      className="size-3.5 accent-foreground"
      checked={skills.length > 0 && on === skills.length}
      ref={(el) => {
        if (el) {
          el.indeterminate = on > 0 && on < skills.length
        }
      }}
      onChange={() => onChange(on < skills.length)}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export function SkillsPanel({ workspace }: { workspace: Workspace }): ReactNode {
  const projectId = workspace.projectId
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const openEditorTab = useStore((s) => s.openEditorTab)
  const toast = useStore((s) => s.toast)
  const [state, setState] = useState<ProjectSkills | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Partial<Record<SkillSource, boolean>>>({})
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await window.relay.skills.list(projectId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [projectId])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    // File lists are cached per skill; drop them so added or removed files show up too.
    setFiles({})
    setExpanded(null)
    await load()
    setRefreshing(false)
  }

  useEffect(() => {
    setState(null)
    setExpanded(null)
    void load()
  }, [load])

  // Skills are plain folders; pick up edits made outside Relay when the window comes back.
  useEffect(() => window.relay.app.onFocusChange((focused) => focused && void load()), [load])

  const enabled = useCallback((skill: SkillInfo) => state?.overrides[skill.key] !== 'off', [state])

  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key)
    try {
      await action()
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(null)
      await load()
    }
  }

  const setEnabled = (skills: SkillInfo[], on: boolean): void => {
    const keys = skills.map((s) => s.key)
    setState((current) => {
      if (!current) {
        return current
      }
      const overrides = { ...current.overrides }
      for (const key of keys) {
        if (on) {
          delete overrides[key]
        } else {
          overrides[key] = 'off'
        }
      }
      return { ...current, overrides }
    })
    void run(keys.join(','), () => window.relay.skills.setEnabled(projectId, keys, on))
  }

  const edit = (skill: SkillInfo, rel = 'SKILL.md'): void => {
    openEditorTab(workspace.id, rel === 'SKILL.md' ? skill.file : joinDir(skill.dir, rel), undefined, `${skill.name}/${rel}`)
  }

  const adapt = (skill: SkillInfo): void => {
    void run(skill.key, async () => {
      const copy = await window.relay.skills.adapt(projectId, skill.key)
      toast('success', `Created ${copy.name} in this project and turned ${skill.name} off here.`)
      edit(copy)
    })
  }

  const remove = (skill: SkillInfo): void => {
    void run(skill.key, async () => {
      await window.relay.skills.remove(projectId, skill.key)
      toast('success', `${skill.name} moved to the Recycle Bin${skill.adaptedFrom ? `; ${skill.adaptedFrom} is back on` : ''}.`)
    })
  }

  const toggleExpanded = (skill: SkillInfo): void => {
    const next = expanded === skill.key ? null : skill.key
    setExpanded(next)
    if (next && !files[skill.key]) {
      void window.relay.skills.files(skill.dir).then((list) => setFiles((current) => ({ ...current, [skill.key]: list })))
    }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const all = state?.skills ?? []
    return q ? all.filter((s) => s.key.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : all
  }, [state, filter])

  const adaptedNames = new Set((state?.skills ?? []).filter((s) => s.source === 'project').map((s) => s.name))
  const toggleable = (state?.skills ?? []).filter((s) => !s.shadowed)
  const activeCount = toggleable.filter(enabled).length

  const renderSkill = (skill: SkillInfo): ReactNode => {
    const on = enabled(skill)
    const isOpen = expanded === skill.key
    const override = state?.overrides[skill.key]
    const hasCopy = skill.source !== 'project' && adaptedNames.has(adaptedSkillName(skill.name))
    return (
      <div key={skill.key} className={cn('group relative rounded-md px-2 py-1.5', isOpen ? 'bg-accent/60' : 'hover:bg-accent/40')}>
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            aria-label={`Use ${skill.name} in this project`}
            className="mt-0.5 size-3.5 shrink-0 accent-foreground"
            checked={on && !skill.shadowed}
            disabled={skill.shadowed || busy !== null}
            onChange={(e) => setEnabled([skill], e.target.checked)}
          />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggleExpanded(skill)}>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cn('truncate font-mono text-xs font-medium', !on && 'text-muted-foreground')}>{skill.name}</span>
              {skill.adaptedFrom ? (
                <span className="shrink-0 rounded bg-blue-500/15 px-1 text-3xs text-blue-500" title={`Adapted from ${skill.adaptedFrom}`}>
                  adapted
                </span>
              ) : null}
              {hasCopy ? <span className="shrink-0 rounded bg-muted px-1 text-3xs text-muted-foreground">has local copy</span> : null}
              {override && override !== 'off' ? (
                <span className="shrink-0 rounded bg-muted px-1 text-3xs text-muted-foreground" title="Set from Claude Code's /skills menu">
                  {override}
                </span>
              ) : null}
              {skill.shadowed ? (
                <span className="flex shrink-0 items-center gap-0.5 text-3xs text-status-warning" title="A personal skill with the same name takes precedence, so this one never loads.">
                  <TriangleAlert className="size-3" /> shadowed
                </span>
              ) : null}
            </div>
            <p className={cn('mt-0.5 text-2xs leading-snug text-muted-foreground', !isOpen && 'line-clamp-2')}>{skill.description || 'No description.'}</p>
          </button>
          {/* Overlaid rather than inline so descriptions keep the full width. */}
          <div
            className={cn(
              'absolute top-1 right-1 items-center rounded-md bg-popover shadow-sm',
              isOpen || busy === skill.key ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'
            )}
          >
            {busy === skill.key ? <Spinner className="m-1.5 size-3.5" /> : null}
            {skill.source !== 'synced' && skill.source !== 'plugin' ? (
              <IconButton label={skill.source === 'personal' ? 'Edit (changes it in every project)' : 'Edit'} className="size-6" onClick={() => edit(skill)}>
                <Pencil className="size-3.5" />
              </IconButton>
            ) : null}
            {skill.source !== 'project' ? (
              <IconButton
                label={hasCopy ? 'Already adapted in this project' : 'Adapt for this project (editable copy)'}
                className="size-6"
                disabled={hasCopy || busy !== null}
                onClick={() => adapt(skill)}
              >
                <CopyPlus className="size-3.5" />
              </IconButton>
            ) : null}
            <IconButton label="Open folder" className="size-6" onClick={() => void window.relay.shell.openPath(skill.dir)}>
              <FolderOpen className="size-3.5" />
            </IconButton>
            {skill.adaptedFrom ? (
              <IconButton label="Delete local copy" className="size-6 hover:text-destructive" disabled={busy !== null} onClick={() => remove(skill)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            ) : null}
          </div>
        </div>
        {isOpen ? (
          <div className="mt-2 ml-5.5 flex flex-col gap-1.5">
            <p className="text-2xs text-muted-foreground">
              {skill.source === 'personal'
                ? 'Edits here change this skill in every project. Use “Adapt” for a copy that only this project uses.'
                : skill.source === 'synced'
                  ? 'Managed by claude.ai sync, which overwrites local edits. Adapt it to get an editable copy for this project.'
                  : skill.source === 'plugin'
                    ? 'Installed by a Claude Code plugin; plugin updates overwrite local edits. Adapt it to get an editable copy for this project.'
                    : skill.adaptedFrom
                    ? `Project copy of ${skill.adaptedFrom}, which is turned off here while this copy exists.`
                    : 'Lives in the repository; commit it to share it with your team.'}
            </p>
            <div className="flex flex-col">
              {files[skill.key] === undefined ? (
                <Spinner className="size-3" />
              ) : (
                files[skill.key].map((rel) => (
                  <button
                    key={rel}
                    type="button"
                    onClick={() => edit(skill, rel)}
                    className="flex h-6 items-center gap-1.5 rounded px-1 text-left text-2xs hover:bg-accent"
                  >
                    <FileIcon name={rel.split('/').pop() ?? rel} />
                    <span className="truncate font-mono">{rel}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold">Skills</span>
          <span className="ml-1.5 truncate text-2xs text-muted-foreground">
            {state ? `${activeCount} of ${toggleable.length} on in ${project?.name ?? 'this project'}` : ''}
          </span>
        </div>
        {state ? (
          <IconButton label="Open ~/.claude/skills" className="size-6" onClick={() => void window.relay.shell.openPath(state.globalDir)}>
            <FolderOpen className="size-3.5" />
          </IconButton>
        ) : null}
        <IconButton label="Refresh" className="size-6" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
        </IconButton>
      </div>
      <div className="px-2 pb-2">
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-input px-2 focus-within:border-ring">
          <Search className="size-3.5 text-muted-foreground" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter skills" className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none" />
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {error ? <p className="px-3 py-2 text-xs text-destructive">{error}</p> : null}
        {!state && !error ? <Spinner className="mx-auto my-6 size-4" /> : null}
        {state
          ? SECTIONS.map(({ source, label, hint }) => {
              const skills = visible.filter((s) => s.source === source)
              if (skills.length === 0 && source !== 'project') {
                return null
              }
              const live = skills.filter((s) => !s.shadowed)
              return (
                <section key={source} className="mb-1">
                  <div
                    role="button"
                    tabIndex={0}
                    title={hint}
                    onClick={() => setCollapsed((c) => ({ ...c, [source]: !c[source] }))}
                    onKeyDown={(e) => e.key === 'Enter' && setCollapsed((c) => ({ ...c, [source]: !c[source] }))}
                    className="flex h-7 cursor-pointer items-center gap-1.5 px-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase select-none"
                  >
                    {collapsed[source] ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    <span className="flex-1">{label}</span>
                    <span className="font-normal normal-case">
                      {live.filter(enabled).length}/{live.length}
                    </span>
                    {live.length ? <SectionCheckbox skills={live} enabled={enabled} onChange={(on) => setEnabled(live, on)} /> : null}
                  </div>
                  {collapsed[source] ? null : skills.length ? (
                    skills.map(renderSkill)
                  ) : (
                    <p className="px-3 pb-2 text-2xs text-muted-foreground">No project skills yet. Use “Adapt” on a skill below to make an editable copy for this project.</p>
                  )}
                </section>
              )
            })
          : null}
      </div>
      {state ? (
        <div className="shrink-0 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          Applies to new Claude Code sessions in every workspace of this project.
          {Object.keys(state.overrides).length ? (
            <>
              {' '}
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => openEditorTab(workspace.id, state.settingsPath, undefined, 'settings.local.json')}
              >
                settings.local.json
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
