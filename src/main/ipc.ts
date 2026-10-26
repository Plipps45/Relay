import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { BrowserWindow, Notification, dialog, ipcMain, shell } from 'electron'
import type {
  CreateWorkspaceRequest,
  Project,
  RemoveWorkspaceRequest,
  Settings,
  UiState,
  WorkspaceMeta,
  WorkspaceSession
} from '@shared/types'
import { suggestWorkspaceName } from '@shared/workspace-names'
import { detectAgents, resolveCommand } from './agents'
import * as files from './files'
import * as gitOps from './git'
import * as obsidian from './obsidian'
import { ptyManager, resolveShell, type SpawnRequest } from './pty'
import { store } from './store'
import * as skills from './skills'
import { getClaudeUsage } from './usage'
import { createWorkspace, listWorkspaces, removeWorkspace } from './workspaces'

const PROJECT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']

async function addProject(path: string): Promise<Project> {
  const isGit = await gitOps.isGitRepo(path)
  const root = isGit ? await gitOps.repoRoot(path) : path
  const state = store().get()
  const existing = state.projects.find((p) => p.path.toLowerCase() === root.toLowerCase())
  if (existing) {
    return existing
  }
  const project: Project = {
    id: randomUUID(),
    name: basename(root),
    path: root,
    color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length],
    isGit,
    setupScript: '',
    addedAt: Date.now()
  }
  store().update((s) => {
    s.projects.push(project)
  })
  return project
}

async function diffContents(cwd: string, path: string, oldPath: string | undefined, mode: 'staged' | 'unstaged' | 'untracked') {
  const working = async (): Promise<string> => {
    const full = join(cwd, path)
    return existsSync(full) ? readFile(full, 'utf8') : ''
  }
  if (mode === 'untracked') {
    return { original: '', modified: await working() }
  }
  if (mode === 'staged') {
    return {
      original: await gitOps.showFile(cwd, `HEAD:${oldPath ?? path}`),
      modified: await gitOps.showFile(cwd, `:${path}`)
    }
  }
  return { original: await gitOps.showFile(cwd, `:${oldPath ?? path}`), modified: await working() }
}

function openInEditor(path: string): boolean {
  const code = resolveCommand('code') ?? resolveCommand('cursor')
  if (!code) {
    return false
  }
  const child = spawn(code, [path], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' })
  child.unref()
  return true
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('state:get', () => store().get())
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => store().update((s) => Object.assign(s.settings, patch)).settings)
  ipcMain.handle('ui:update', (_e, patch: Partial<UiState>) => {
    store().update((s) => Object.assign(s.ui, patch))
  })
  ipcMain.handle('session:set', (_e, workspaceId: string, session: WorkspaceSession | null) => {
    store().setSession(workspaceId, session)
  })

  ipcMain.handle('dialog:pickFolder', async (_e, title?: string) => {
    const window = getWindow()
    const options = { title: title ?? 'Select folder', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('projects:add', (_e, path: string) => addProject(path))
  ipcMain.handle('projects:update', (_e, id: string, patch: Partial<Project>) => {
    store().update((s) => {
      const project = s.projects.find((p) => p.id === id)
      if (project) {
        Object.assign(project, patch, { id: project.id, path: project.path })
      }
    })
  })
  ipcMain.handle('projects:remove', (_e, id: string) => {
    store().update((s) => {
      s.projects = s.projects.filter((p) => p.id !== id)
    })
  })
  ipcMain.handle('projects:clone', async (_e, url: string, parentDir: string) => {
    const name = basename(url.replace(/\.git$/, '').replace(/[\\/]+$/, ''))
    const target = join(parentDir, name)
    if (existsSync(target)) {
      throw new Error(`${target} already exists.`)
    }
    await gitOps.git(parentDir, ['clone', url, target])
    return addProject(target)
  })

  ipcMain.handle('workspaces:list', () => listWorkspaces())
  ipcMain.handle('workspaces:create', async (_e, request: CreateWorkspaceRequest) => {
    const result = await createWorkspace(request)
    // Not fatal: the worktree exists either way, it just starts with every global skill on.
    await skills.syncSkillsToCheckout(request.projectId, result.workspace.path).catch(() => undefined)
    return result
  })
  ipcMain.handle('workspaces:remove', (_e, request: RemoveWorkspaceRequest) => removeWorkspace(request))
  ipcMain.handle('workspaces:updateMeta', (_e, path: string, patch: Partial<WorkspaceMeta>) => {
    store().update((s) => {
      s.workspaceMeta[path] = { ...(s.workspaceMeta[path] ?? {}), ...patch }
    })
  })
  ipcMain.handle('workspaces:suggestName', async (_e, projectId: string) => {
    const state = store().get()
    const workspaces = await listWorkspaces()
    const used = [
      ...workspaces.filter((w) => w.projectId === projectId).map((w) => basename(w.path)),
      ...(state.retiredNames[projectId] ?? [])
    ]
    return suggestWorkspaceName(used)
  })

  ipcMain.handle('git:status', (_e, cwd: string) => gitOps.status(cwd))
  ipcMain.handle('git:branches', (_e, cwd: string) => gitOps.branches(cwd))
  ipcMain.handle('git:defaultBase', (_e, cwd: string) => gitOps.defaultBaseRef(cwd))
  ipcMain.handle('git:stage', (_e, cwd: string, paths: string[]) => gitOps.stage(cwd, paths))
  ipcMain.handle('git:unstage', (_e, cwd: string, paths: string[]) => gitOps.unstage(cwd, paths))
  ipcMain.handle('git:discard', async (_e, cwd: string, paths: string[], untracked: string[]) => {
    if (paths.length) {
      await gitOps.discardTracked(cwd, paths)
    }
    for (const path of untracked) {
      await shell.trashItem(join(cwd, path))
    }
  })
  ipcMain.handle('git:commit', (_e, cwd: string, message: string, all: boolean) => gitOps.commit(cwd, message, all))
  ipcMain.handle('git:push', (_e, cwd: string) => gitOps.push(cwd))
  ipcMain.handle('git:pull', (_e, cwd: string) => gitOps.pull(cwd))
  ipcMain.handle('git:log', (_e, cwd: string, limit: number) => gitOps.log(cwd, limit))
  ipcMain.handle(
    'git:diffContents',
    (_e, cwd: string, path: string, oldPath: string | undefined, mode: 'staged' | 'unstaged' | 'untracked') =>
      diffContents(cwd, path, oldPath, mode)
  )

  ipcMain.handle('skills:list', (_e, projectId: string) => skills.listProjectSkillState(projectId))
  ipcMain.handle('skills:setEnabled', (_e, projectId: string, keys: string[], enabled: boolean) => skills.setSkillsEnabled(projectId, keys, enabled))
  ipcMain.handle('skills:adapt', (_e, projectId: string, key: string) => skills.adaptSkill(projectId, key))
  ipcMain.handle('skills:remove', (_e, projectId: string, key: string) => skills.removeProjectSkill(projectId, key))
  ipcMain.handle('skills:files', (_e, dir: string) => skills.listSkillFiles(dir))
  ipcMain.handle('usage:get', () => getClaudeUsage())

  ipcMain.handle('obsidian:vaults', () => obsidian.listVaults())
  ipcMain.handle('obsidian:index', (_e, root: string) => obsidian.indexVault(root))
  ipcMain.handle('obsidian:search', (_e, root: string, query: string, limit: number) => obsidian.searchVault(root, query, limit))
  ipcMain.handle('obsidian:create', (_e, root: string, path: string, content: string) => obsidian.createNote(root, path, content))
  ipcMain.handle('obsidian:template', (_e, root: string, template: string) => obsidian.readTemplate(root, template))

  ipcMain.handle('fs:readDir', (_e, path: string) => files.readDir(path))
  ipcMain.handle('fs:readFile', (_e, path: string) => files.readFileContent(path))
  ipcMain.handle('fs:writeFile', (_e, path: string, content: string) => files.writeTextFile(path, content))
  ipcMain.handle('fs:create', (_e, path: string, directory: boolean) => files.createEntry(path, directory))
  ipcMain.handle('fs:rename', (_e, from: string, to: string) => files.renameEntry(from, to))
  ipcMain.handle('fs:trash', (_e, path: string) => files.trashEntry(path))
  ipcMain.handle('fs:listFiles', (_e, root: string) => files.listFiles(root))
  ipcMain.handle('fs:search', (_e, root: string, query: string, options: files.SearchOptions) => files.searchText(root, query, options))
  ipcMain.handle('fs:exists', (_e, path: string) => existsSync(path))
  ipcMain.on('fs:watch', (event, workspaceId: string, root: string) => files.workspaceWatchers.watch(event.sender, workspaceId, root))
  ipcMain.on('fs:unwatch', (_e, workspaceId: string) => files.workspaceWatchers.unwatch(workspaceId))

  ipcMain.handle('pty:spawn', (event, request: SpawnRequest) => ptyManager.spawn(event.sender, request))
  ipcMain.handle('pty:shellKind', () => resolveShell().kind)
  ipcMain.handle('pty:isAlive', (_e, id: string) => ptyManager.isAlive(id))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptyManager.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptyManager.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => ptyManager.kill(id))

  ipcMain.handle('agents:detect', (_e, force: boolean) => detectAgents(force))

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // obsidian:// hands a note over to the Obsidian app.
    if (/^(https?|obsidian):\/\//i.test(url)) {
      return shell.openExternal(url)
    }
  })
  ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('shell:openInEditor', (_e, path: string) => openInEditor(path))

  ipcMain.handle('app:notify', (_e, payload: { title: string; body: string; workspaceId: string }) => {
    const { settings } = store().get()
    const window = getWindow()
    if (!settings.notifyOnAgentDone || !Notification.isSupported()) {
      return
    }
    if (settings.notifyOnlyWhenUnfocused && window?.isFocused()) {
      return
    }
    const notification = new Notification({ title: payload.title, body: payload.body, silent: false })
    notification.on('click', () => {
      const target = getWindow()
      if (target) {
        if (target.isMinimized()) {
          target.restore()
        }
        target.focus()
        target.webContents.send('notification:click', payload.workspaceId)
      }
    })
    notification.show()
  })

  ipcMain.handle('app:saveImage', async (_e, base64Png: string) => {
    const dir = join(tmpdir(), 'relay-attachments')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `capture-${Date.now()}.png`)
    await writeFile(path, Buffer.from(base64Png, 'base64'))
    return path
  })

  ipcMain.handle('window:setOverlay', (_e, color: string, symbolColor: string) => {
    const window = getWindow()
    if (window && process.platform !== 'darwin') {
      window.setTitleBarOverlay({ color, symbolColor, height: 38 })
    }
  })
}
