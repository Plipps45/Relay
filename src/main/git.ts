import { execFile } from 'node:child_process'
import { normalize } from 'node:path'
import type { BranchRef, GitFileStatus, GitStatus } from '@shared/types'

export class GitError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.stderr = stderr
  }
}

export function git(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message
          reject(new GitError(detail.split('\n').slice(-3).join('\n'), stderr))
          return
        }
        resolve(stdout)
      }
    )
    if (input !== undefined) {
      child.stdin?.end(input)
    }
  })
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const out = await git(path, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

export async function repoRoot(path: string): Promise<string> {
  const out = await git(path, ['rev-parse', '--show-toplevel'])
  return normalize(out.trim())
}

export type WorktreeEntry = {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  prunable: boolean
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current)
      }
      current = {
        path: normalize(line.slice('worktree '.length)),
        head: null,
        branch: null,
        bare: false,
        detached: false,
        prunable: false
      }
      continue
    }
    if (!current) {
      continue
    }
    if (line.startsWith('HEAD ')) {
      current.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'detached') {
      current.detached = true
    } else if (line.startsWith('prunable')) {
      current.prunable = true
    }
  }
  if (current) {
    entries.push(current)
  }
  return entries
}

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const out = await git(repoPath, ['worktree', 'list', '--porcelain'])
  return parseWorktreeList(out).filter((entry) => !entry.bare)
}

export function parseStatusV2(output: string): GitStatus {
  const status: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] }
  const records = output.split('\0')
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record) {
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length)
      status.branch = head === '(detached)' ? null : head
    } else if (record.startsWith('# branch.upstream ')) {
      status.upstream = record.slice('# branch.upstream '.length)
    } else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
    } else if (record.startsWith('1 ')) {
      const parts = record.split(' ')
      status.files.push(fileStatus(parts.slice(8).join(' '), parts[1]))
    } else if (record.startsWith('2 ')) {
      const parts = record.split(' ')
      const file = fileStatus(parts.slice(9).join(' '), parts[1])
      file.oldPath = records[i + 1]
      i += 1
      status.files.push(file)
    } else if (record.startsWith('u ')) {
      const parts = record.split(' ')
      const file = fileStatus(parts.slice(10).join(' '), parts[1])
      file.conflicted = true
      status.files.push(file)
    } else if (record.startsWith('? ')) {
      status.files.push({
        path: record.slice(2),
        index: '?',
        worktree: '?',
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false
      })
    }
  }
  return status
}

function fileStatus(path: string, xy: string): GitFileStatus {
  const index = xy[0] ?? '.'
  const worktree = xy[1] ?? '.'
  return {
    path,
    index,
    worktree,
    staged: index !== '.',
    unstaged: worktree !== '.',
    untracked: false,
    conflicted: false
  }
}

export async function status(cwd: string): Promise<GitStatus> {
  const out = await git(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  return parseStatusV2(out)
}

export async function branches(cwd: string): Promise<BranchRef[]> {
  const out = await git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname)%09%(HEAD)',
    'refs/heads',
    'refs/remotes'
  ])
  const refs: BranchRef[] = []
  for (const line of out.split(/\r?\n/)) {
    const [refname, head] = line.split('\t')
    if (!refname || refname.endsWith('/HEAD')) {
      continue
    }
    const remote = refname.startsWith('refs/remotes/')
    refs.push({
      name: refname.replace(/^refs\/(heads|remotes)\//, ''),
      remote,
      current: head === '*'
    })
  }
  return refs
}

export async function defaultBaseRef(cwd: string): Promise<string | null> {
  try {
    const out = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    return out.trim() || null
  } catch {
    try {
      const out = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const branch = out.trim()
      return branch && branch !== 'HEAD' ? branch : null
    } catch {
      return null
    }
  }
}

export async function userName(cwd: string): Promise<string | null> {
  try {
    const out = await git(cwd, ['config', 'user.name'])
    const slug = out
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[~^:?*[\\\s]/g, '')
    return slug || null
  } catch {
    return null
  }
}

export async function hasHead(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** File contents at a revision; `:path` reads the index. Missing paths read as empty. */
export async function showFile(cwd: string, spec: string): Promise<string> {
  try {
    return await git(cwd, ['show', spec])
  } catch {
    return ''
  }
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ['add', '--', ...paths])
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (await hasHead(cwd)) {
    await git(cwd, ['restore', '--staged', '--', ...paths])
  } else {
    await git(cwd, ['rm', '--cached', '-q', '--', ...paths])
  }
}

export async function discardTracked(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ['restore', '--worktree', '--', ...paths])
}

export async function commit(cwd: string, message: string, all: boolean): Promise<void> {
  const args = ['commit', '-F', '-']
  if (all) {
    args.splice(1, 0, '-a')
  }
  await git(cwd, args, message)
}

export async function push(cwd: string): Promise<void> {
  await git(cwd, ['push', '-u', 'origin', 'HEAD'])
}

export async function pull(cwd: string): Promise<void> {
  await git(cwd, ['pull', '--ff-only'])
}

export async function log(cwd: string, limit: number): Promise<{ hash: string; subject: string; author: string; date: number }[]> {
  try {
    const out = await git(cwd, ['log', `-${limit}`, '--format=%H%x09%s%x09%an%x09%ct'])
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, date] = line.split('\t')
        return { hash, subject, author, date: Number(date) * 1000 }
      })
  } catch {
    return []
  }
}
