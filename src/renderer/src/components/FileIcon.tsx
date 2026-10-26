import type { ReactNode } from 'react'
import { File, FileCode2, FileImage, FileJson, FileText, FileTerminal, Settings2 } from 'lucide-react'

const CODE = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'rb', 'php', 'vue', 'svelte', 'css', 'scss', 'html', 'lua', 'dart'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'])
const TEXT = new Set(['md', 'markdown', 'txt', 'rst', 'log'])
const SHELL = new Set(['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'])
const CONFIG = new Set(['yml', 'yaml', 'toml', 'ini', 'env', 'lock', 'gitignore', 'editorconfig'])

const CODE_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#eab308',
  jsx: '#eab308',
  mjs: '#eab308',
  py: '#3b82f6',
  go: '#06b6d4',
  rs: '#f97316',
  css: '#8b5cf6',
  scss: '#ec4899',
  html: '#f97316',
  vue: '#22c55e'
}

export function FileIcon({ name }: { name: string }): ReactNode {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop() ?? '' : lower
  const className = 'size-3.5 shrink-0'
  if (ext === 'json' || ext === 'jsonc') {
    return <FileJson className={className} style={{ color: '#eab308' }} />
  }
  if (CODE.has(ext)) {
    return <FileCode2 className={className} style={{ color: CODE_COLORS[ext] ?? 'var(--muted-foreground)' }} />
  }
  if (IMAGE.has(ext)) {
    return <FileImage className={className} style={{ color: '#a855f7' }} />
  }
  if (TEXT.has(ext)) {
    return <FileText className={className} style={{ color: '#60a5fa' }} />
  }
  if (SHELL.has(ext)) {
    return <FileTerminal className={className} style={{ color: '#22c55e' }} />
  }
  if (CONFIG.has(ext) || lower.startsWith('.')) {
    return <Settings2 className={className} style={{ color: 'var(--muted-foreground)' }} />
  }
  return <File className={`${className} text-muted-foreground`} />
}
