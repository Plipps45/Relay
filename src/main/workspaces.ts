import { existsSync, readFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import type {
  CreateWorkspaceRequest,
  CreateWorkspaceResult,
  Project,
  RemoveWorkspaceRequest,
  Workspace,
  WorkspaceMeta
} from '@shared/types'
import { normalizeWorkspaceName } from '@shared/workspace-names'
import * as gitOps from './git'
import { store } from './store'

function buildWorkspace(project: Project, entry: gitOps.WorktreeEntry | null, meta: WorkspaceMeta | undefined): Workspace {
  const path = entry ? entry.path : project.path
  const isMain = entry ? normalize(entry.path).toLowerCase() === normalize(project.path).toLowerCase() : true
  return {
    id: path,
    projectId: project.id,
    path,
    branch: entry?.branch ?? null,
    head: entry?.head ?? null,
    isMain,
    isFolder: !entry,
    displayName: meta?.displayName || (isMain ? entry?.branch || basename(path) : basename(path)),
    status: meta?.status ?? (isMain ? 'todo' : 'in-progress'),
    pinned: meta?.pinned ?? false,
    createdAt: meta?.createdAt ?? 0,
    lastActiveAt: meta?.lastActiveAt ?? 0,
    comments: meta?.comments ?? []
  }
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const state = store().get()
  const results = await Promise.all(
    state.projects.map(async (project) => {
      if (!existsSync(project.path)) {
        return []
      }
      if (!project.isGit) {
        return [buildWorkspace(project, null, state.workspaceMeta[project.path])]
      }
      try {
        const entries = await gitOps.listWorktrees(project.path)
        return entries
          .filter((entry) => !entry.prunable)
          .map((entry) => buildWorkspace(project, entry, state.workspaceMeta[entry.path]))
      } catch {
        return [buildWorkspace(project, null, state.workspaceMeta[project.path])]
      }
    })
  )
  return results.flat()
}

/** Reads `scripts.setup` from relay.yaml without a YAML dependency. */
export function readSetupScriptFromRepo(root: string): string | null {
  for (const file of ['relay.yaml']) {
    const path = join(root, file)
    if (!existsSync(path)) {
      continue
    }
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    const scriptsIndex = lines.findIndex((line) => /^scripts:\s*$/.test(line))
    if (scriptsIndex === -1) {
      continue
    }
    for (let i = scriptsIndex + 1; i < lines.length; i += 1) {
      const match = /^(\s+)setup:\s*(.*)$/.exec(lines[i])
      if (!match) {
        if (/^\S/.test(lines[i])) {
          break
        }
        continue
      }
      const inline = match[2].trim()
      if (inline && inline !== '|' && inline !== '>') {
        return inline.replace(/^['"]|['"]$/g, '')
      }
      const keyIndent = match[1].length
      const body: string[] = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        const indent = line.length - line.trimStart().length
        if (line.trim() && indent <= keyIndent) {
          break
        }
        body.push(line.trim())
      }
      const script = body.filter(Boolean).join('\n')
      return script || null
    }
  }
  return null
}

function branchPrefix(gitUser: string | null): string | null {
  const { settings } = store().get()
  const raw =
    settings.branchPrefix === 'git-username'
      ? gitUser
      : settings.branchPrefix === 'custom'
        ? settings.branchPrefixCustom
        : null
  const cleaned = raw?.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')
  return cleaned || null
}

export async function createWorkspace(request: CreateWorkspaceRequest): Promise<CreateWorkspaceResult> {
  const state = store().get()
  const project = state.projects.find((p) => p.id === request.projectId)
  if (!project) {
    throw new Error('Project not found.')
  }
  if (!project.isGit) {
    throw new Error('Workspaces need a git repository. This project is a plain folder.')
  }
  const name = normalizeWorkspaceName(request.name)
  if (!name) {
    throw new Error('Enter a workspace name.')
  }
  const parent = state.settings.nestWorkspaces
    ? join(state.settings.workspaceDir, project.name)
    : state.settings.workspaceDir
  const path = join(parent, name)
  if (existsSync(path)) {
    throw new Error(`A folder already exists at ${path}.`)
  }
  const prefix = branchPrefix(await gitOps.userName(project.path))
  const branch = prefix ? `${prefix}/${name}` : name
  const existing = await gitOps.branches(project.path)
  const branchExists = existing.some((ref) => !ref.remote && ref.name === branch)
  const args = ['worktree', 'add']
  if (branchExists) {
    args.push(path, branch)
  } else {
    args.push('--no-track', '-b', branch, path)
    if (request.baseRef) {
      args.push(request.baseRef)
    }
  }
  await gitOps.git(project.path, args)

  const now = Date.now()
  store().update((s) => {
    s.workspaceMeta[path] = {
      displayName: request.name.trim() || name,
      status: 'in-progress',
      createdAt: now,
      lastActiveAt: now
    }
  })
  const entries = await gitOps.listWorktrees(project.path)
  const entry = entries.find((e) => e.path.toLowerCase() === normalize(path).toLowerCase()) ?? {
    path,
    head: null,
    branch,
    bare: false,
    detached: false,
    prunable: false
  }
  const setupScript = state.settings.runSetupScript
    ? project.setupScript.trim() || readSetupScriptFromRepo(path)
    : null
  return {
    workspace: buildWorkspace(project, entry, store().get().workspaceMeta[entry.path]),
    setupScript
  }
}

export async function removeWorkspace(request: RemoveWorkspaceRequest): Promise<void> {
  const workspaces = await listWorkspaces()
  const workspace = workspaces.find((w) => w.id === request.workspaceId)
  if (!workspace) {
    throw new Error('Workspace not found.')
  }
  if (workspace.isMain || workspace.isFolder) {
    throw new Error('The main checkout cannot be deleted. Remove the project instead.')
  }
  const project = store().get().projects.find((p) => p.id === workspace.projectId)
  if (!project) {
    throw new Error('Project not found.')
  }
  const args = ['worktree', 'remove']
  if (request.force) {
    args.push('--force')
  }
  args.push(workspace.path)
  await gitOps.git(project.path, args)
  if (request.deleteBranch && workspace.branch) {
    await gitOps.git(project.path, ['branch', '-D', workspace.branch]).catch(() => undefined)
  }
  await gitOps.git(project.path, ['worktree', 'prune']).catch(() => undefined)
  store().update((s) => {
    delete s.workspaceMeta[workspace.path]
    const retired = new Set(s.retiredNames[project.id] ?? [])
    retired.add(basename(workspace.path).toLowerCase())
    s.retiredNames[project.id] = [...retired]
  })
  store().setSession(workspace.id, null)
}
