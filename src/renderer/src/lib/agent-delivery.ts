import { findAgent } from '@shared/agents'
import type { DiffComment } from '@shared/types'
import { useStore } from '@/store/app-store'
import { focusTerminal, pasteIntoTerminal } from './terminal-registry'

export type AgentTarget = { tabId: string; paneId: string; label: string }

/** Agent panes in a workspace, the active pane first. */
export function agentTargets(workspaceId: string): AgentTarget[] {
  const state = useStore.getState()
  const session = state.sessions[workspaceId]
  if (!session) {
    return []
  }
  const targets: AgentTarget[] = []
  for (const tab of session.tabs) {
    if (tab.kind !== 'terminal') {
      continue
    }
    for (const pane of tab.panes) {
      const runtime = state.paneRuntime[pane.id]
      if (runtime?.agentId && !runtime.exited) {
        targets.push({ tabId: tab.id, paneId: pane.id, label: findAgent(runtime.agentId)?.label ?? runtime.title })
      }
    }
  }
  const activePane = session.activeTabId ? state.activePaneByTab[session.activeTabId] : undefined
  return targets.sort((a, b) => Number(b.paneId === activePane) - Number(a.paneId === activePane))
}

/**
 * Pastes text into the workspace's agent composer without submitting, then
 * brings that pane forward so the user can review and press Enter.
 */
export function sendToAgent(workspaceId: string, text: string, target?: AgentTarget): boolean {
  const state = useStore.getState()
  const chosen = target ?? agentTargets(workspaceId)[0]
  if (!chosen) {
    state.toast('error', 'No agent is running in this workspace. Start one from the + menu first.')
    return false
  }
  state.setActiveTab(workspaceId, chosen.tabId)
  state.setActivePane(chosen.tabId, chosen.paneId)
  const ok = pasteIntoTerminal(chosen.paneId, text)
  if (!ok) {
    state.toast('error', 'That agent terminal is not running.')
    return false
  }
  setTimeout(() => focusTerminal(chosen.paneId), 60)
  state.toast('success', `Sent to ${chosen.label}`)
  return true
}

export function formatReviewComments(comments: DiffComment[]): string {
  const lines = ['Please address these review comments on the diff:', '']
  const byFile = new Map<string, DiffComment[]>()
  for (const comment of comments) {
    byFile.set(comment.filePath, [...(byFile.get(comment.filePath) ?? []), comment])
  }
  for (const [file, fileComments] of byFile) {
    for (const comment of fileComments.sort((a, b) => a.line - b.line)) {
      const side = comment.side === 'original' ? ' (removed line)' : ''
      lines.push(`- ${file}:${comment.line}${side} — ${comment.text.trim()}`)
    }
  }
  return lines.join('\n')
}
