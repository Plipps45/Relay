import type { ReactNode } from 'react'
import { Files, GitBranch, Search, Sparkles } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { useStore } from '@/store/app-store'
import { shortcutLabel } from '@/lib/shortcuts'
import { FileExplorer } from './FileExplorer'
import { SearchPanel } from './SearchPanel'
import { SkillsPanel } from './SkillsPanel'
import { SourceControl } from './SourceControl'
import { IconButton } from './ui'

export function RightSidebar({ workspace }: { workspace: Workspace }): ReactNode {
  const ui = useStore((s) => s.ui)
  const updateUi = useStore((s) => s.updateUi)
  const changes = useStore((s) => s.gitStatus[workspace.id]?.files.length ?? 0)
  const tab = ui?.rightSidebarTab ?? 'explorer'

  return (
    <aside className="flex h-full flex-col border-l border-border bg-card" style={{ width: ui?.rightSidebarWidth ?? 320 }}>
      <div className="drag-region titlebar-overlay-pad flex h-[38px] shrink-0 items-center gap-0.5 border-b border-border pl-2">
        <IconButton label={`Explorer (${shortcutLabel('explorer')})`} active={tab === 'explorer'} onClick={() => updateUi({ rightSidebarTab: 'explorer' })}>
          <Files className="size-4" />
        </IconButton>
        <IconButton label={`Source control (${shortcutLabel('sourceControl')})`} active={tab === 'changes'} onClick={() => updateUi({ rightSidebarTab: 'changes' })} className="relative">
          <GitBranch className="size-4" />
          {changes > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-blue-500 px-0.5 text-center text-[9px] leading-3.5 font-semibold text-white">
              {changes > 99 ? '99+' : changes}
            </span>
          ) : null}
        </IconButton>
        <IconButton label={`Search (${shortcutLabel('search')})`} active={tab === 'search'} onClick={() => updateUi({ rightSidebarTab: 'search' })}>
          <Search className="size-4" />
        </IconButton>
        <IconButton label="Claude skills" active={tab === 'skills'} onClick={() => updateUi({ rightSidebarTab: 'skills' })}>
          <Sparkles className="size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'explorer' ? (
          <FileExplorer workspace={workspace} />
        ) : tab === 'changes' ? (
          <SourceControl workspace={workspace} />
        ) : tab === 'skills' ? (
          <SkillsPanel workspace={workspace} />
        ) : (
          <SearchPanel workspace={workspace} />
        )}
      </div>
    </aside>
  )
}
