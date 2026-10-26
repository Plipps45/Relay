import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { shell } from 'electron'
import type { Project, ProjectSkills, SkillInfo, SkillSource } from '@shared/types'
import { adaptedSkillName, parseSkillFrontmatter, renameSkillFrontmatter } from '@shared/skill-frontmatter'
import * as gitOps from './git'
import { store } from './store'

/*
 * Claude Code loads personal skills (~/.claude/skills) in every project, so
 * "enabled per project" is expressed the way its own /skills menu does it:
 * `skillOverrides: { "<skill>": "off" }` in .claude/settings.local.json.
 * Linked worktrees do not read the main checkout's settings.local.json, so
 * every checkout of the project gets the same overrides.
 */

const SYNCED_NAMESPACE = 'anthropic-skills'
const SETTINGS_FILE = join('.claude', 'settings.local.json')
const SHARED_SETTINGS_FILE = join('.claude', 'settings.json')

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

function globalSkillsDir(): string {
  return join(claudeDir(), 'skills')
}

function projectSkillsDir(root: string): string {
  return join(root, '.claude', 'skills')
}

function findProject(projectId: string): Project {
  const project = store().get().projects.find((p) => p.id === projectId)
  if (!project) {
    throw new Error('Project not found.')
  }
  return project
}

async function readSkill(dir: string, source: SkillSource, keyPrefix = ''): Promise<SkillInfo | null> {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) {
    return null
  }
  const meta = parseSkillFrontmatter(await readFile(file, 'utf8'))
  const name = meta.name || dir.split(/[\\/]/).pop() || dir
  return {
    key: keyPrefix ? `${keyPrefix}:${name}` : name,
    name,
    description: meta.description ?? '',
    source,
    dir,
    file,
    adaptedFrom: null,
    shadowed: false
  }
}

async function subdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return []
  }
  const entries = await readdir(dir, { withFileTypes: true })
  // Junctions show up as symlinks; a linked skill folder is still a skill.
  return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => join(dir, e.name))
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

type InstalledPlugin = { id: string; installPath: string; scope?: string; projectPath?: string }

/** installed_plugins.json: v2 keeps an array of installs (one per scope) per plugin, v1 a single entry. */
async function installedPlugins(): Promise<InstalledPlugin[]> {
  const data = await readJson(join(claudeDir(), 'plugins', 'installed_plugins.json'))
  const plugins = data.plugins && typeof data.plugins === 'object' ? (data.plugins as Record<string, unknown>) : {}
  const out: InstalledPlugin[] = []
  for (const [id, value] of Object.entries(plugins)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry && typeof entry === 'object' && typeof (entry as InstalledPlugin).installPath === 'string') {
        out.push({ ...(entry as InstalledPlugin), id })
      }
    }
  }
  return out
}

/** enabledPlugins merged the way Claude Code layers settings: user, then project, then local. */
async function enabledPlugins(projectPath: string): Promise<Record<string, unknown>> {
  const files = [join(claudeDir(), 'settings.json'), join(projectPath, SHARED_SETTINGS_FILE), join(projectPath, SETTINGS_FILE)]
  const merged: Record<string, unknown> = {}
  for (const file of files) {
    const value = (await readJson(file)).enabledPlugins
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(merged, value)
    }
  }
  return merged
}

function samePath(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase()
}

/** Skills from installed plugins, listed by Claude as <plugin>:<skill>. User installs apply everywhere, project/local ones only to their project. */
async function listPluginSkills(projectPath: string): Promise<SkillInfo[]> {
  const enabled = await enabledPlugins(projectPath)
  const seen = new Set<string>()
  const skills: SkillInfo[] = []
  for (const plugin of await installedPlugins()) {
    const inScope = !plugin.projectPath || samePath(plugin.projectPath, projectPath)
    if (!inScope || enabled[plugin.id] === false || seen.has(plugin.id) || !existsSync(plugin.installPath)) {
      continue
    }
    seen.add(plugin.id)
    const manifest = await readJson(join(plugin.installPath, '.claude-plugin', 'plugin.json'))
    const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : plugin.id.split('@')[0]
    // plugin.json "skills" adds folders on top of the default skills/.
    const extra = manifest.skills
    const roots = ['skills', ...(typeof extra === 'string' ? [extra] : Array.isArray(extra) ? extra.filter((p): p is string => typeof p === 'string') : [])]
    for (const rel of new Set(roots.map((r) => normalize(join(plugin.installPath, r))))) {
      const candidates = existsSync(join(rel, 'SKILL.md')) ? [rel] : await subdirs(rel)
      for (const dir of candidates) {
        const skill = await readSkill(dir, 'plugin', name)
        if (skill && !skills.some((s) => s.key === skill.key)) {
          skills.push(skill)
        }
      }
    }
  }
  return skills
}

async function listGlobalSkills(projectPath: string): Promise<SkillInfo[]> {
  const root = globalSkillsDir()
  const personal = await Promise.all(
    (await subdirs(root)).filter((dir) => !/[\\/]synced$/.test(dir)).map((dir) => readSkill(dir, 'personal'))
  )
  // claude.ai sync writes skills to synced/<account>/<skill>/ and Claude lists them as anthropic-skills:<name>.
  const synced: (SkillInfo | null)[] = []
  for (const account of await subdirs(join(root, 'synced'))) {
    synced.push(...(await Promise.all((await subdirs(account)).map((dir) => readSkill(dir, 'synced', SYNCED_NAMESPACE)))))
  }
  const plugins = await listPluginSkills(projectPath)
  return [...personal, ...synced, ...plugins].filter((s): s is SkillInfo => s !== null)
}

async function listProjectSkills(root: string, globals: SkillInfo[]): Promise<SkillInfo[]> {
  const skills = (await Promise.all((await subdirs(projectSkillsDir(root))).map((dir) => readSkill(dir, 'project')))).filter(
    (s): s is SkillInfo => s !== null
  )
  return skills.map((skill) => {
    const origin = globals.find((g) => adaptedSkillName(g.name) === skill.name)
    const shadowed = globals.some((g) => g.source === 'personal' && g.name === skill.name)
    return { ...skill, adaptedFrom: origin?.key ?? null, shadowed }
  })
}

async function readSettings(root: string): Promise<Record<string, unknown>> {
  const path = join(root, SETTINGS_FILE)
  if (!existsSync(path)) {
    return {}
  }
  const raw = (await readFile(path, 'utf8')).trim()
  if (!raw) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Never overwrite a file we cannot parse; the user may be mid-edit.
    throw new Error(`${path} is not valid JSON. Fix it before changing skills.`)
  }
}

function overridesOf(settings: Record<string, unknown>): Record<string, string> {
  const value = settings.skillOverrides
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** Every checkout Claude may run in for this project: the main one plus each linked worktree. */
async function checkouts(project: Project): Promise<string[]> {
  if (!project.isGit) {
    return [project.path]
  }
  try {
    const entries = await gitOps.listWorktrees(project.path)
    const paths = entries.filter((e) => !e.prunable && existsSync(e.path)).map((e) => e.path)
    return paths.length ? paths : [project.path]
  } catch {
    return [project.path]
  }
}

function isMainCheckout(project: Project, path: string): boolean {
  return samePath(path, project.path)
}

/** Keep settings.local.json out of `git status` in every worktree; info/exclude is shared by all of them. */
async function excludeSettingsFile(project: Project): Promise<void> {
  if (!project.isGit) {
    return
  }
  try {
    const common = (await gitOps.git(project.path, ['rev-parse', '--git-common-dir'])).trim()
    const gitDir = isAbsolute(common) ? common : join(project.path, common)
    const excludePath = join(gitDir, 'info', 'exclude')
    const current = existsSync(excludePath) ? await readFile(excludePath, 'utf8') : ''
    const line = '.claude/settings.local.json'
    if (current.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === `/${line}`)) {
      return
    }
    await mkdir(join(gitDir, 'info'), { recursive: true })
    await writeFile(excludePath, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`)
  } catch {
    // Cosmetic only; the overrides still apply.
  }
}

async function writeOverrides(root: string, apply: (overrides: Record<string, string>) => void): Promise<void> {
  const settings = await readSettings(root)
  const overrides = overridesOf(settings)
  apply(overrides)
  if (Object.keys(overrides).length) {
    settings.skillOverrides = overrides
  } else {
    delete settings.skillOverrides
  }
  const path = join(root, SETTINGS_FILE)
  if (!Object.keys(settings).length) {
    if (existsSync(path)) {
      await writeFile(path, '{}\n')
    }
    return
  }
  await mkdir(join(root, '.claude'), { recursive: true })
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`)
}

export async function listProjectSkillState(projectId: string): Promise<ProjectSkills> {
  const project = findProject(projectId)
  const globals = await listGlobalSkills(project.path)
  const local = await listProjectSkills(project.path, globals)
  const order: Record<SkillSource, number> = { project: 0, personal: 1, plugin: 2, synced: 3 }
  const skills = [...globals, ...local].sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name))
  return {
    skills,
    overrides: overridesOf(await readSettings(project.path)),
    globalDir: globalSkillsDir(),
    settingsPath: join(project.path, SETTINGS_FILE)
  }
}

export async function setSkillsEnabled(projectId: string, keys: string[], enabled: boolean): Promise<void> {
  const project = findProject(projectId)
  for (const root of await checkouts(project)) {
    await writeOverrides(root, (overrides) => {
      for (const key of keys) {
        if (enabled) {
          delete overrides[key]
        } else {
          overrides[key] = 'off'
        }
      }
    })
  }
  await excludeSettingsFile(project)
}

/**
 * A worktree without its own .claude/skills falls back to the main checkout's,
 * but one that commits .claude/skills does not; link adapted copies into those.
 */
async function linkIntoWorktrees(project: Project, skillDir: string, name: string): Promise<void> {
  for (const root of await checkouts(project)) {
    if (isMainCheckout(project, root)) {
      continue
    }
    const dir = projectSkillsDir(root)
    const link = join(dir, name)
    if (existsSync(dir) && !existsSync(link)) {
      await symlink(skillDir, link, 'junction').catch(() => undefined)
    }
  }
}

export async function adaptSkill(projectId: string, key: string): Promise<SkillInfo> {
  const project = findProject(projectId)
  const source = (await listGlobalSkills(project.path)).find((s) => s.key === key)
  if (!source) {
    throw new Error(`Skill ${key} not found.`)
  }
  const name = adaptedSkillName(source.name)
  const target = join(projectSkillsDir(project.path), name)
  if (existsSync(target)) {
    throw new Error(`${name} already exists in this project.`)
  }
  await mkdir(projectSkillsDir(project.path), { recursive: true })
  await cp(source.dir, target, { recursive: true, dereference: true })
  const file = join(target, 'SKILL.md')
  await writeFile(file, renameSkillFrontmatter(await readFile(file, 'utf8'), name))
  await linkIntoWorktrees(project, target, name)
  // The copy replaces the original here; both on would give Claude two near-identical skills.
  await setSkillsEnabled(projectId, [source.key], false)
  const skill = await readSkill(target, 'project')
  if (!skill) {
    throw new Error('Copy failed.')
  }
  return { ...skill, adaptedFrom: source.key }
}

export async function removeProjectSkill(projectId: string, key: string): Promise<void> {
  const project = findProject(projectId)
  const state = await listProjectSkillState(projectId)
  const skill = state.skills.find((s) => s.source === 'project' && s.key === key)
  if (!skill) {
    throw new Error(`Project skill ${key} not found.`)
  }
  for (const root of await checkouts(project)) {
    const link = join(projectSkillsDir(root), skill.name)
    if (!isMainCheckout(project, root) && existsSync(link) && (await lstat(link)).isSymbolicLink()) {
      await unlink(link).catch(() => rm(link, { force: true }))
    }
  }
  await shell.trashItem(skill.dir)
  const enabled = [skill.key, ...(skill.adaptedFrom ? [skill.adaptedFrom] : [])]
  // Clear a stale "off" for the removed key and give the project its original skill back.
  await setSkillsEnabled(projectId, enabled, true)
}

/** Text files inside a skill folder, relative paths, for the panel's file list. */
export async function listSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (current: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 3 || out.length >= 200) {
      return
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel, depth + 1)
      } else if (/\.(md|mdx|txt|json|ya?ml|toml|sh|ps1|py|js|mjs|cjs|ts|html|css)$/i.test(entry.name)) {
        out.push(rel)
      }
    }
  }
  await walk(dir, '', 0)
  return out.sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md'))
}

/** Bring a new worktree in line with the project: same overrides, and links for adapted skills when needed. */
export async function syncSkillsToCheckout(projectId: string, root: string): Promise<void> {
  const project = findProject(projectId)
  if (isMainCheckout(project, root)) {
    return
  }
  const overrides = overridesOf(await readSettings(project.path))
  if (Object.keys(overrides).length) {
    await writeOverrides(root, (target) => Object.assign(target, overrides))
  }
  for (const dir of await subdirs(projectSkillsDir(project.path))) {
    const name = dir.split(/[\\/]/).pop() ?? ''
    if (name.endsWith('-local')) {
      await linkIntoWorktrees(project, dir, name)
    }
  }
}
