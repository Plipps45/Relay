import { useEffect, useRef, type ReactNode } from 'react'
import type { UiState } from '@shared/types'
import { activeWorkspace, useStore } from '@/store/app-store'
import { matchShortcut } from '@/lib/shortcuts'
import { onSystemThemeChange, resolveDark } from '@/lib/theme'
import { focusTerminal, setTerminalAppearance, snapshotScrollback } from '@/lib/terminal-registry'
import { paneIds } from '@/lib/split-layout'
import { Sidebar } from './components/Sidebar'
import { RightSidebar } from './components/RightSidebar'
import { TabBar, WorkbenchContent } from './components/Workbench'
import { Landing, StatusBar, Toaster, UpdatePrompt } from './components/Chrome'
import { ComposerDialog } from './components/ComposerDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { QuickOpen } from './components/QuickOpen'
import { AddProjectDialog, DeleteWorkspaceDialog, ProjectSettingsDialog, RenameWorkspaceDialog } from './components/Dialogs'

const GIT_POLL_MS = 5000

function applyTheme(): void {
  const settings = useStore.getState().settings
  const dark = resolveDark(settings?.theme)
  document.documentElement.classList.toggle('dark', dark)
  setTerminalAppearance(dark, settings?.terminalFontFamily, settings?.terminalFontSize)
  const styles = getComputedStyle(document.documentElement)
  const background = styles.getPropertyValue('--background').trim() || (dark ? '#0a0a0a' : '#ffffff')
  const foreground = styles.getPropertyValue('--foreground').trim() || (dark ? '#fafafa' : '#0a0a0a')
  void window.relay.app.setTitleBarOverlay(background, foreground)
}

function toggleRightPanel(tab: UiState['rightSidebarTab']): void {
  const { ui, updateUi } = useStore.getState()
  if (!ui) {
    return
  }
  if (ui.rightSidebarOpen && ui.rightSidebarTab === tab) {
    updateUi({ rightSidebarOpen: false })
  } else {
    updateUi({ rightSidebarOpen: true, rightSidebarTab: tab })
  }
}

function handleShortcut(event: KeyboardEvent): void {
  const match = matchShortcut(event)
  if (!match) {
    return
  }
  const state = useStore.getState()
  const workspace = activeWorkspace(state)
  const session = workspace ? state.sessions[workspace.id] : undefined
  const tabs = session?.tabs ?? []
  const activeIndex = tabs.findIndex((t) => t.id === session?.activeTabId)
  const activeTab = tabs[activeIndex]
  const consume = (): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  switch (match.id) {
    case 'newWorkspace':
      consume()
      if (state.projects.length) {
        state.setDialog({ kind: 'composer', projectId: workspace?.projectId })
      } else {
        state.setDialog({ kind: 'add-project' })
      }
      return
    case 'jumpWorkspace':
      consume()
      state.setPalette('workspaces')
      return
    case 'settings':
      consume()
      state.setDialog({ kind: 'settings' })
      return
    case 'toggleLeftSidebar':
      consume()
      state.toggleLeftSidebar()
      return
    case 'nextWorkspace':
    case 'prevWorkspace': {
      consume()
      const list = state.workspaces
      if (!list.length) {
        return
      }
      const current = list.findIndex((w) => w.id === workspace?.id)
      const step = match.id === 'nextWorkspace' ? 1 : -1
      const next = list[(current + step + list.length) % list.length]
      state.selectWorkspace(next.id)
      return
    }
  }

  if (!workspace) {
    return
  }

  switch (match.id) {
    case 'newTerminal':
      consume()
      state.openTerminalTab(workspace.id)
      return
    case 'newBrowser':
      consume()
      state.openBrowserTab(workspace.id)
      return
    case 'notes':
      consume()
      state.openNotesTab(workspace.id)
      return
    case 'closeTab':
      consume()
      if (activeTab) {
        state.closeTab(workspace.id, activeTab.id)
      }
      return
    case 'closePane':
      consume()
      if (activeTab?.kind === 'terminal') {
        const paneId = state.activePaneByTab[activeTab.id] ?? paneIds(activeTab.layout)[0]
        state.closePane(workspace.id, activeTab.id, paneId)
      } else if (activeTab) {
        state.closeTab(workspace.id, activeTab.id)
      }
      return
    case 'quickOpen':
      consume()
      state.setPalette('files')
      return
    case 'nextTab':
    case 'prevTab':
      consume()
      if (tabs.length > 1) {
        const step = match.id === 'nextTab' ? 1 : -1
        state.setActiveTab(workspace.id, tabs[(activeIndex + step + tabs.length) % tabs.length].id)
      }
      return
    case 'selectTab': {
      const target = match.index === 8 ? tabs[tabs.length - 1] : tabs[match.index ?? 0]
      if (target) {
        consume()
        state.setActiveTab(workspace.id, target.id)
      }
      return
    }
    case 'splitRight':
      consume()
      state.splitActivePane(workspace.id, 'row')
      return
    case 'splitDown':
      consume()
      state.splitActivePane(workspace.id, 'column')
      return
    case 'explorer':
      consume()
      toggleRightPanel('explorer')
      return
    case 'sourceControl':
      consume()
      toggleRightPanel('changes')
      return
    case 'search':
      consume()
      state.updateUi({ rightSidebarOpen: true, rightSidebarTab: 'search' })
      state.focusSearch()
      return
    case 'focusNextPane':
    case 'focusPrevPane': {
      if (activeTab?.kind !== 'terminal') {
        return
      }
      consume()
      const ids = paneIds(activeTab.layout)
      if (ids.length < 2) {
        return
      }
      const current = ids.indexOf(state.activePaneByTab[activeTab.id] ?? ids[0])
      const step = match.id === 'focusNextPane' ? 1 : -1
      const next = ids[(current + step + ids.length) % ids.length]
      state.setActivePane(activeTab.id, next)
      focusTerminal(next)
      return
    }
  }
}

function ResizeHandle({ side }: { side: 'left' | 'right' }): ReactNode {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const ui = useStore.getState().ui
    if (!ui) {
      return
    }
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? ui.sidebarWidth : ui.rightSidebarWidth
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    let latest = startWidth
    const onMove = (move: PointerEvent): void => {
      const delta = side === 'left' ? move.clientX - startX : startX - move.clientX
      latest = Math.round(Math.min(560, Math.max(200, startWidth + delta)))
      const current = useStore.getState().ui
      if (current) {
        // Local-only while dragging; persisted once on release.
        useStore.setState({ ui: side === 'left' ? { ...current, sidebarWidth: latest } : { ...current, rightSidebarWidth: latest } })
      }
    }
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      useStore.getState().updateUi(side === 'left' ? { sidebarWidth: latest } : { rightSidebarWidth: latest })
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }
  return (
    <div
      onPointerDown={onPointerDown}
      className="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize transition-colors hover:bg-ring/40"
      role="separator"
      aria-orientation="vertical"
    />
  )
}

function DialogHost(): ReactNode {
  const dialog = useStore((s) => s.dialog)
  if (!dialog) {
    return null
  }
  switch (dialog.kind) {
    case 'composer':
      return <ComposerDialog initialProjectId={dialog.projectId} initialPrompt={dialog.prompt} />
    case 'add-project':
      return <AddProjectDialog />
    case 'settings':
      return <SettingsDialog initialSection={dialog.section} />
    case 'delete-workspace':
      return <DeleteWorkspaceDialog workspaceId={dialog.workspaceId} />
    case 'rename-workspace':
      return <RenameWorkspaceDialog workspaceId={dialog.workspaceId} />
    case 'project-settings':
      return <ProjectSettingsDialog projectId={dialog.projectId} />
  }
}

export function App(): ReactNode {
  const loaded = useStore((s) => s.loaded)
  const settings = useStore((s) => s.settings)
  const ui = useStore((s) => s.ui)
  const leftSidebarOpen = useStore((s) => s.leftSidebarOpen)
  const palette = useStore((s) => s.palette)
  const workspace = useStore(activeWorkspace)
  const watchedRef = useRef<string | null>(null)

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  useEffect(() => {
    applyTheme()
    return onSystemThemeChange(applyTheme)
  }, [settings?.theme, settings?.terminalFontFamily, settings?.terminalFontSize])

  useEffect(() => {
    // Capture phase so shortcuts win over xterm and Monaco key handlers.
    window.addEventListener('keydown', handleShortcut, true)
    return () => window.removeEventListener('keydown', handleShortcut, true)
  }, [])

  useEffect(() => {
    const previous = watchedRef.current
    if (previous && previous !== workspace?.id) {
      window.relay.fs.unwatch(previous)
    }
    watchedRef.current = workspace?.id ?? null
    if (!workspace) {
      return
    }
    window.relay.fs.watch(workspace.id, workspace.path)
    const refresh = (): void => void useStore.getState().refreshGit(workspace.id)
    let pending: ReturnType<typeof setTimeout> | null = null
    const offChanged = window.relay.fs.onChanged((workspaceId) => {
      if (workspaceId !== workspace.id || pending) {
        return
      }
      pending = setTimeout(() => {
        pending = null
        refresh()
      }, 300)
    })
    const interval = setInterval(() => document.visibilityState === 'visible' && refresh(), GIT_POLL_MS)
    return () => {
      offChanged()
      clearInterval(interval)
      if (pending) {
        clearTimeout(pending)
      }
    }
  }, [workspace?.id, workspace?.path])

  useEffect(() => {
    void window.relay.updater.get().then((update) => useStore.getState().setUpdate(update))
    const offUpdate = window.relay.updater.onStatus((update) => useStore.getState().setUpdate(update))
    const offClick = window.relay.app.onNotificationClick((workspaceId) => useStore.getState().selectWorkspace(workspaceId))
    const offFocus = window.relay.app.onFocusChange((focused) => {
      const state = useStore.getState()
      state.setWindowFocused(focused)
      const id = state.ui?.activeWorkspaceId
      if (focused && id) {
        state.markUnread(id, false)
      }
    })
    const offClose = window.relay.app.onBeforeClose(() => {
      const scrollback = snapshotScrollback()
      const { sessions } = useStore.getState()
      const writes = Object.entries(sessions).map(([workspaceId, session]) =>
        window.relay.state.setSession(workspaceId, {
          ...session,
          tabs: session.tabs.map((tab) =>
            tab.kind === 'terminal'
              ? { ...tab, panes: tab.panes.map((pane) => (scrollback[pane.id] ? { ...pane, scrollback: scrollback[pane.id] } : pane)) }
              : tab
          )
        })
      )
      void Promise.allSettled(writes).then(() => window.relay.app.closeReady())
    })
    return () => {
      offUpdate()
      offClick()
      offFocus()
      offClose()
    }
  }, [])

  if (!loaded || !ui) {
    return <div className="h-screen bg-background" />
  }

  const rightOpen = ui.rightSidebarOpen && Boolean(workspace)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        {leftSidebarOpen ? (
          <>
            <Sidebar />
            <ResizeHandle side="left" />
          </>
        ) : null}
        <main className="flex min-w-0 flex-1 flex-col border-l border-border">
          <TabBar workspace={workspace} reserveControls={!rightOpen} />
          <div className="min-h-0 flex-1">{workspace ? <WorkbenchContent workspace={workspace} /> : <Landing />}</div>
        </main>
        {rightOpen && workspace ? (
          <>
            <ResizeHandle side="right" />
            <RightSidebar workspace={workspace} />
          </>
        ) : null}
      </div>
      <StatusBar workspace={workspace} />
      <DialogHost />
      {palette ? <QuickOpen mode={palette} /> : null}
      <Toaster />
      <UpdatePrompt />
    </div>
  )
}
