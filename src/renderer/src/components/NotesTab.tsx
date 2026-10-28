import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Ellipsis,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  ExternalLink,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Link2,
  ListTree,
  Network,
  NotebookText,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Unlink,
  Vault
} from 'lucide-react'
import type { ObsidianVault, SearchMatch, TabSession, VaultIndex, VaultNote } from '@shared/types'
import {
  createResolver,
  formatDailyNote,
  noteTitle,
  parseNote,
  parseProperties,
  splitFrontmatter,
  toggleTask,
  uniqueNoteName,
  type LinkResolver
} from '@shared/obsidian'
import { errorMessage, useStore } from '@/store/app-store'
import { sendToAgent } from '@/lib/agent-delivery'
import { colorizeCodeBlocks, renderMarkdown } from '@/lib/markdown'
import { monaco } from '@/lib/monaco'
import { registerVaultCompletions } from '@/lib/note-completions'
import { useIsDark } from '@/lib/theme'
import { NotesGraph, type GraphEdge, type GraphNode } from './NotesGraph'
import { Button, IconButton, Input, Spinner, cn, useMenu, type MenuItem } from './ui'

type NotesTabSession = Extract<TabSession, { kind: 'notes' }>
type View = 'read' | 'edit' | 'split'
type Panel = 'files' | 'search' | 'tags'

type VaultGraph = {
  resolve: LinkResolver
  byPath: Map<string, VaultNote>
  backlinks: Map<string, string[]>
  tags: Map<string, string[]>
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const TREE_PAGE = 300

type FolderNode = { name: string; path: string; folders: FolderNode[]; notes: VaultNote[] }

const EMPTY_GRAPH: VaultGraph = { resolve: () => null, byPath: new Map(), backlinks: new Map(), tags: new Map(), nodes: [], edges: [] }

function absolutePath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

function folderOf(rel: string): string {
  const index = rel.lastIndexOf('/')
  return index === -1 ? '' : rel.slice(0, index)
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function obsidianUri(path: string): string {
  return `obsidian://open?path=${encodeURIComponent(path)}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildGraph(index: VaultIndex | null): VaultGraph {
  if (!index) {
    return EMPTY_GRAPH
  }
  const resolve = createResolver([...index.notes.map((n) => n.path), ...index.files])
  const byPath = new Map(index.notes.map((note) => [note.path, note]))
  const backlinks = new Map<string, string[]>()
  const tags = new Map<string, string[]>()
  const edges: GraphEdge[] = []
  for (const note of index.notes) {
    const targets = new Set<string>()
    for (const link of [...note.links, ...note.embeds]) {
      const target = resolve(link, note.path)
      if (target && target !== note.path && byPath.has(target)) {
        targets.add(target)
      }
    }
    for (const target of targets) {
      const list = backlinks.get(target)
      if (list) {
        list.push(note.path)
      } else {
        backlinks.set(target, [note.path])
      }
      edges.push({ source: note.path, target })
    }
    for (const tag of note.tags) {
      const list = tags.get(tag)
      if (list) {
        list.push(note.path)
      } else {
        tags.set(tag, [note.path])
      }
    }
  }
  return { resolve, byPath, backlinks, tags, nodes: index.notes.map((n) => ({ id: n.path, label: n.title })), edges }
}

function buildTree(notes: VaultNote[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], notes: [] }
  const byPath = new Map<string, FolderNode>([['', root]])
  for (const note of notes) {
    let folder = root
    const parts = note.path.split('/').slice(0, -1)
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let next = byPath.get(path)
      if (!next) {
        next = { name: part, path, folders: [], notes: [] }
        byPath.set(path, next)
        folder.folders.push(next)
      }
      folder = next
    })
    folder.notes.push(note)
  }
  const sort = (folder: FolderNode): void => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    folder.notes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
    folder.folders.forEach(sort)
  }
  sort(root)
  return root
}

/** The part of a note under `heading`, up to the next heading of the same or higher level. */
function sectionOf(body: string, heading: string): string {
  const lines = body.split('\n')
  const start = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    return match && match[2].toLowerCase() === heading.toLowerCase()
  })
  if (start === -1) {
    return body
  }
  const level = /^(#+)/.exec(lines[start])![1].length
  const end = lines.findIndex((line, i) => i > start && /^(#{1,6})\s/.test(line) && /^(#+)/.exec(line)![1].length <= level)
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

function applyTemplate(template: string, title: string, date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return template
    .replace(/\{\{\s*date\s*\}\}/gi, formatDailyNote('', date))
    .replace(/\{\{\s*time\s*\}\}/gi, `${pad(date.getHours())}:${pad(date.getMinutes())}`)
    .replace(/\{\{\s*title\s*\}\}/gi, title)
}

export function NotesTab({ workspaceId, tab, visible }: { workspaceId: string; tab: NotesTabSession; visible: boolean }): ReactNode {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const updateTab = useStore((s) => s.updateTab)
  const toast = useStore((s) => s.toast)
  const isDark = useIsDark()
  const vaultPath = tab.vaultPath
  const notePath = tab.notePath

  const [vaults, setVaults] = useState<ObsidianVault[] | null>(null)
  const [index, setIndex] = useState<VaultIndex | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [note, setNote] = useState<{ path: string; text: string } | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<View>('read')
  const [mode, setMode] = useState<'note' | 'graph'>('note')
  const [panel, setPanel] = useState<Panel>('files')
  const [rightOpen, setRightOpen] = useState(true)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [titleDraft, setTitleDraft] = useState('')
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 })

  const noteRef = useRef(note)
  noteRef.current = note
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const savedRef = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const pendingHeading = useRef<string | null>(null)
  const pendingLine = useRef<number | null>(null)
  const imageCache = useRef(new Map<string, string>())
  const viewRef = useRef(view)
  viewRef.current = view
  const menu = useMenu()

  const graph = useMemo(() => buildGraph(index), [index])
  // Rebuilt only on reindex; building it on every render froze typing in large vaults.
  const tree = useMemo(() => (index ? buildTree(index.notes) : null), [index])
  const files = useMemo(() => new Set(index?.files), [index])
  const notesRef = useRef<VaultNote[]>([])
  notesRef.current = index?.notes ?? []

  // --- vault & index -------------------------------------------------------

  useEffect(() => {
    void window.relay.obsidian.vaults().then(setVaults, () => setVaults([]))
  }, [])

  // A new tab has no vault yet: use the configured one, else the one Obsidian has open.
  useEffect(() => {
    if (vaultPath || !vaults) {
      return
    }
    const fallback = settings?.notesVault || vaults[0]?.path
    if (fallback) {
      updateTab(workspaceId, tab.id, { vaultPath: fallback })
    }
  }, [vaultPath, vaults, settings?.notesVault, updateTab, workspaceId, tab.id])

  const reindex = useCallback(async () => {
    if (!vaultPath) {
      return
    }
    try {
      setIndex(await window.relay.obsidian.index(vaultPath))
      setIndexError(null)
    } catch (err) {
      setIndexError(errorMessage(err))
    }
  }, [vaultPath])

  useEffect(() => {
    setIndex(null)
    imageCache.current.clear()
    void reindex()
  }, [reindex])

  useEffect(() => (vaultPath ? registerVaultCompletions(vaultPath, () => notesRef.current) : undefined), [vaultPath])

  // --- current note ----------------------------------------------------------

  const syncModel = (path: string, text: string): void => {
    const model = monaco.editor.getModel(monaco.Uri.file(absolutePath(vaultPath, path)))
    if (model && model.getValue() !== text) {
      model.setValue(text)
    }
  }

  const loadNote = useCallback(
    async (path: string) => {
      try {
        const content = await window.relay.fs.readFile(absolutePath(vaultPath, path))
        if (content.kind !== 'text') {
          setNoteError('This file is not a text note.')
          return
        }
        savedRef.current = content.content
        setNote({ path, text: content.content })
        setDirty(false)
        setNoteError(null)
        syncModel(path, content.content)
      } catch (err) {
        setNote(null)
        setNoteError(errorMessage(err))
      }
    },
    // syncModel only depends on vaultPath.
    [vaultPath]
  )

  useEffect(() => {
    setTitleDraft(notePath ? noteTitle(notePath) : '')
    if (!notePath || !vaultPath) {
      setNote(null)
      return
    }
    void loadNote(notePath)
  }, [notePath, vaultPath, loadNote])

  const save = useCallback(
    async (text?: string) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const current = noteRef.current
      const value = text ?? current?.text
      if (!current || value === undefined || value === savedRef.current) {
        return
      }
      try {
        await window.relay.fs.writeFile(absolutePath(vaultPath, current.path), value)
        savedRef.current = value
        setDirty(false)
      } catch (err) {
        toast('error', `Could not save ${current.path}: ${errorMessage(err)}`)
      }
    },
    [vaultPath, toast]
  )

  // Agents and Obsidian itself edit the vault too: reindex, and reload the open note when it has no local edits.
  useEffect(() => {
    if (!vaultPath) {
      return undefined
    }
    const watchId = `notes:${tab.id}`
    window.relay.fs.watch(watchId, vaultPath)
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.relay.fs.onChanged((id, paths) => {
      if (id !== watchId) {
        return
      }
      const changed = paths.map((p) => p.split(/[\\/]/).join('/')).filter((p) => !/^\.(obsidian|git|trash)(\/|$)/.test(p))
      if (!changed.length) {
        return
      }
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => void reindex(), 250)
      const current = noteRef.current
      if (current && !dirtyRef.current && changed.some((p) => p.toLowerCase() === current.path.toLowerCase())) {
        void window.relay.fs.readFile(absolutePath(vaultPath, current.path)).then(
          (content) => {
            if (content.kind === 'text' && content.content !== savedRef.current && !dirtyRef.current) {
              savedRef.current = content.content
              setNote({ path: current.path, text: content.content })
              syncModel(current.path, content.content)
            }
          },
          () => undefined
        )
      }
    })
    return () => {
      off()
      if (timer) {
        clearTimeout(timer)
      }
      window.relay.fs.unwatch(watchId)
    }
  }, [vaultPath, tab.id, reindex])

  useEffect(() => {
    updateTab(workspaceId, tab.id, { title: notePath ? noteTitle(notePath) : vaultPath ? baseName(vaultPath) : 'Notes' })
  }, [notePath, vaultPath, updateTab, workspaceId, tab.id])

  // Keep the current note's folders open in the tree.
  useEffect(() => {
    if (!notePath) {
      return
    }
    const parts = notePath.split('/').slice(0, -1)
    setExpanded((prev) => {
      const next = new Set(prev)
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/')))
      return next.size === prev.size ? prev : next
    })
  }, [notePath])

  // --- navigation ------------------------------------------------------------

  const openNote = useCallback(
    (path: string, options: { heading?: string; line?: number; push?: boolean; view?: View } = {}) => {
      void save()
      pendingHeading.current = options.heading || null
      pendingLine.current = options.line ?? null
      if (options.view) {
        setView(options.view)
      }
      setMode('note')
      if (options.push !== false && path !== notePath) {
        setHistory((h) => {
          const stack = [...h.stack.slice(0, h.index + 1), path]
          return { stack, index: stack.length - 1 }
        })
      }
      if (path === notePath) {
        scrollToTarget()
      } else {
        updateTab(workspaceId, tab.id, { notePath: path })
      }
    },
    [save, notePath, updateTab, workspaceId, tab.id]
  )

  const goHistory = (delta: number): void => {
    const target = history.index + delta
    const path = history.stack[target]
    if (path) {
      setHistory({ ...history, index: target })
      openNote(path, { push: false })
    }
  }

  const createAndOpen = async (path: string, content = ''): Promise<void> => {
    try {
      await window.relay.obsidian.create(vaultPath, path, content)
      await reindex()
      openNote(path, { view: viewRef.current === 'read' ? 'edit' : viewRef.current })
    } catch (err) {
      toast('error', `Could not create ${path}: ${errorMessage(err)}`)
    }
  }

  const newNote = async (): Promise<void> => {
    const path = uniqueNoteName('Untitled', '', [...graph.byPath.keys()])
    await createAndOpen(path)
    setTimeout(() => titleRef.current?.select(), 80)
  }

  const openDailyNote = async (): Promise<void> => {
    const config = index?.dailyNotes ?? { folder: '', format: '', template: '' }
    const date = new Date()
    const name = formatDailyNote(config.format, date)
    const path = `${config.folder ? `${config.folder}/` : ''}${name}.md`
    if (graph.byPath.has(path)) {
      openNote(path)
      return
    }
    const template = await window.relay.obsidian.template(vaultPath, config.template)
    await createAndOpen(path, applyTemplate(template, baseName(name), date))
  }

  const followLink = (target: string, resolved: string, heading: string): void => {
    if (resolved) {
      openNote(resolved, { heading })
    } else if (!target) {
      pendingHeading.current = heading
      scrollToTarget()
    } else if (/\.[a-z0-9]{1,5}$/i.test(target) && !/\.md$/i.test(target)) {
      toast('error', `${target} is not in this vault.`)
    } else {
      // Clicking an unresolved link creates the note, like Obsidian.
      void createAndOpen(/\.md$/i.test(target) ? target : `${target}.md`)
    }
  }

  function scrollToTarget(): void {
    const heading = pendingHeading.current
    const line = pendingLine.current
    if (!heading && !line) {
      return
    }
    requestAnimationFrame(() => {
      const editor = editorRef.current
      const current = noteRef.current
      const headingLine = heading && current ? parseNote(current.text).headings.find((h) => h.text.toLowerCase() === heading.toLowerCase())?.line : undefined
      const targetLine = line || headingLine
      if (editor && viewRef.current !== 'read' && targetLine) {
        editor.revealLineInCenter(targetLine)
        editor.setPosition({ lineNumber: targetLine, column: 1 })
      }
      if (heading && previewRef.current) {
        const element = [...previewRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(
          (h) => h.textContent?.trim().toLowerCase() === heading.toLowerCase()
        )
        element?.scrollIntoView({ block: 'start' })
      }
      pendingHeading.current = null
      pendingLine.current = null
    })
  }

  // --- editing ---------------------------------------------------------------

  const onEdit = (value: string): void => {
    const current = noteRef.current
    if (!current) {
      return
    }
    setNote({ path: current.path, text: value })
    const changed = value !== savedRef.current
    setDirty(changed)
    if (changed) {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }
      // Obsidian saves continuously; so does this tab.
      saveTimer.current = setTimeout(() => void save(), 600)
    }
  }

  const toggleView = (): void => setView((v) => (v === 'read' ? 'edit' : 'read'))

  const onEditorMount: OnMount = (editor) => {
    editorRef.current = editor
    const current = noteRef.current
    if (current && editor.getValue() !== current.text) {
      editor.setValue(current.text)
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () => toggleView())
    scrollToTarget()
  }

  const renameNote = async (): Promise<void> => {
    const current = noteRef.current
    const name = titleDraft.trim().replace(/\.md$/i, '')
    if (!current || !name || name === noteTitle(current.path)) {
      setTitleDraft(current ? noteTitle(current.path) : '')
      return
    }
    if (/[\\/:*?"<>|#^[\]]/.test(name)) {
      toast('error', 'Note names cannot contain \\ / : * ? " < > | # ^ [ ]')
      setTitleDraft(noteTitle(current.path))
      return
    }
    const folder = folderOf(current.path)
    const next = `${folder ? `${folder}/` : ''}${name}.md`
    if (graph.byPath.has(next) && next.toLowerCase() !== current.path.toLowerCase()) {
      toast('error', `${next} already exists.`)
      setTitleDraft(noteTitle(current.path))
      return
    }
    await save()
    const oldTitle = noteTitle(current.path)
    const sources = graph.backlinks.get(current.path) ?? []
    try {
      await window.relay.fs.rename(absolutePath(vaultPath, current.path), absolutePath(vaultPath, next))
      // Update [[Old]], [[Old|alias]], [[Old#heading]] and [[folder/Old]] in the notes that link here.
      const pattern = new RegExp(`(!?\\[\\[(?:[^\\]|#\\n]*/)?)${escapeRegExp(oldTitle)}(?=(?:\\.md)?[\\]|#\\\\])`, 'gi')
      let updated = 0
      for (const source of sources) {
        const file = absolutePath(vaultPath, source === current.path ? next : source)
        const content = await window.relay.fs.readFile(file)
        if (content.kind === 'text') {
          const replaced = content.content.replace(pattern, `$1${name}`)
          if (replaced !== content.content) {
            await window.relay.fs.writeFile(file, replaced)
            updated += 1
          }
        }
      }
      setHistory((h) => ({ ...h, stack: h.stack.map((p) => (p === current.path ? next : p)) }))
      updateTab(workspaceId, tab.id, { notePath: next })
      await reindex()
      if (updated) {
        toast('success', `Renamed and updated links in ${updated} note${updated === 1 ? '' : 's'}`)
      }
    } catch (err) {
      toast('error', `Could not rename: ${errorMessage(err)}`)
      setTitleDraft(oldTitle)
    }
  }

  const trashNote = async (path: string): Promise<void> => {
    try {
      await window.relay.fs.trash(absolutePath(vaultPath, path))
      if (path === notePath) {
        updateTab(workspaceId, tab.id, { notePath: null })
      }
      await reindex()
    } catch (err) {
      toast('error', `Could not delete ${path}: ${errorMessage(err)}`)
    }
  }

  const sendNote = (path: string): void => {
    const selection = window.getSelection()
    const selected = selection && previewRef.current?.contains(selection.anchorNode) ? selection.toString().trim() : ''
    const file = absolutePath(vaultPath, path)
    const title = noteTitle(path)
    const editorSelection = editorRef.current ? editorRef.current.getModel()?.getValueInRange(editorRef.current.getSelection() ?? new monaco.Range(1, 1, 1, 1)) : ''
    const excerpt = selected || (viewRef.current !== 'read' ? editorSelection?.trim() : '')
    sendToAgent(
      workspaceId,
      excerpt
        ? `From my Obsidian note "${title}" (${file}):\n\n${excerpt}\n\n`
        : `Read my Obsidian note "${title}" at ${file} and use it as context. `
    )
  }

  const switchVault = (path: string): void => {
    void save()
    setHistory({ stack: [], index: -1 })
    setSelectedTag(null)
    updateTab(workspaceId, tab.id, { vaultPath: path, notePath: null })
    void updateSettings({ notesVault: path })
  }

  const pickVaultFolder = async (): Promise<void> => {
    const path = await window.relay.dialog.pickFolder('Open folder as vault')
    if (path) {
      switchVault(path)
    }
  }

  const vaultMenu = (): MenuItem[] => [
    { kind: 'header', label: vaults?.length ? 'Obsidian vaults' : 'No vaults registered in Obsidian' },
    ...(vaults ?? []).map(
      (vault): MenuItem => ({
        label: vault.name,
        checked: vault.path.toLowerCase() === vaultPath.toLowerCase(),
        icon: <Vault />,
        onSelect: () => switchVault(vault.path)
      })
    ),
    { kind: 'separator' },
    { label: 'Open folder as vault…', icon: <FolderOpen />, onSelect: () => void pickVaultFolder() },
    ...(vaultPath
      ? ([
          { label: 'Open vault in Obsidian', icon: <ExternalLink />, onSelect: () => void window.relay.shell.openExternal(obsidianUri(vaultPath)) },
          { label: 'Reveal vault folder', icon: <FolderOpen />, onSelect: () => void window.relay.shell.showItem(vaultPath) }
        ] as MenuItem[])
      : [])
  ]

  const noteMenu = (path: string): MenuItem[] => [
    { label: 'Open in Obsidian', icon: <ExternalLink />, onSelect: () => void window.relay.shell.openExternal(obsidianUri(absolutePath(vaultPath, path))) },
    { label: 'Send to agent', icon: <Send />, onSelect: () => sendNote(path) },
    { label: 'Copy wikilink', icon: <Link2 />, onSelect: () => void navigator.clipboard.writeText(`[[${noteTitle(path)}]]`) },
    { label: 'Copy path', icon: <Copy />, onSelect: () => void navigator.clipboard.writeText(absolutePath(vaultPath, path)) },
    { label: 'Reveal in File Explorer', icon: <FolderOpen />, onSelect: () => void window.relay.shell.showItem(absolutePath(vaultPath, path)) },
    { kind: 'separator' },
    { label: 'Move to trash', icon: <Trash2 />, danger: true, onSelect: () => void trashNote(path) }
  ]

  // --- preview ---------------------------------------------------------------

  const parsed = useMemo(() => (note ? splitFrontmatter(note.text) : null), [note])
  const properties = useMemo(() => parseProperties(parsed?.frontmatter ?? null), [parsed])
  const headings = useMemo(() => (note ? parseNote(note.text).headings : []), [note])
  const html = useMemo(() => {
    if (!note || !parsed) {
      return ''
    }
    return renderMarkdown(parsed.body, { resolve: (target) => graph.resolve(target, note.path), allowEmbeds: true })
  }, [note, parsed, graph])
  // React compares this prop by identity; a fresh object would reset the DOM (and its loaded images) every render.
  const htmlProp = useMemo(() => ({ __html: html }), [html])

  // Images, embedded notes and code highlighting are filled in after the HTML lands.
  useEffect(() => {
    const root = previewRef.current
    const current = noteRef.current
    if (!root || !current || view === 'edit' || mode !== 'note') {
      return
    }
    let cancelled = false
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-src]')) {
      const raw = img.dataset.src ?? ''
      const rel = graph.byPath.has(raw) || files.has(raw) ? raw : graph.resolve(decodeURIComponent(raw), current.path)
      if (!rel) {
        continue
      }
      const cached = imageCache.current.get(rel)
      if (cached) {
        img.src = cached
        continue
      }
      void window.relay.fs.readFile(absolutePath(vaultPath, rel)).then(
        (content) => {
          if (content.kind === 'image') {
            imageCache.current.set(rel, content.dataUrl)
            if (!cancelled) {
              img.src = content.dataUrl
            }
          }
        },
        () => undefined
      )
    }
    for (const embed of root.querySelectorAll<HTMLElement>('.md-embed-note[data-path]')) {
      const path = embed.dataset.path ?? ''
      void window.relay.fs.readFile(absolutePath(vaultPath, path)).then(
        (content) => {
          if (cancelled || content.kind !== 'text') {
            return
          }
          const body = splitFrontmatter(content.content).body
          const section = embed.dataset.heading ? sectionOf(body, embed.dataset.heading) : body
          embed.innerHTML = `<a class="md-wikilink md-embed-title" data-path="${path.replace(/"/g, '&quot;')}" data-target="" data-heading="">${noteTitle(path).replace(/</g, '&lt;')}</a>${renderMarkdown(section, { resolve: (t) => graph.resolve(t, path), allowEmbeds: false })}`
          void colorizeCodeBlocks(embed, isDark)
        },
        () => undefined
      )
    }
    void colorizeCodeBlocks(root, isDark)
    scrollToTarget()
    return () => {
      cancelled = true
    }
  }, [html, view, mode, isDark])

  const onPreviewClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const element = event.target as HTMLElement
    const checkbox = element.closest<HTMLInputElement>('input[data-task]')
    if (checkbox && note) {
      event.preventDefault()
      const text = toggleTask(note.text, Number(checkbox.dataset.task))
      syncModel(note.path, text)
      setNote({ path: note.path, text })
      void save(text)
      return
    }
    const anchor = element.closest('a')
    if (!anchor) {
      return
    }
    event.preventDefault()
    if (anchor.classList.contains('md-wikilink')) {
      followLink(anchor.dataset.target ?? '', anchor.dataset.path ?? '', anchor.dataset.heading ?? '')
      return
    }
    if (anchor.classList.contains('md-tag')) {
      setSelectedTag(anchor.dataset.tag ?? null)
      setPanel('tags')
      return
    }
    const href = anchor.getAttribute('href') ?? ''
    if (/^(https?|obsidian):/i.test(href)) {
      void window.relay.shell.openExternal(href)
    } else if (href.startsWith('#')) {
      pendingHeading.current = decodeURIComponent(href.slice(1)).replace(/-/g, ' ')
      scrollToTarget()
    } else if (href && note) {
      const [target, heading = ''] = decodeURIComponent(href).split('#')
      followLink(target, graph.resolve(target, note.path) ?? '', heading)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault()
      toggleView()
    } else if (mod && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      goHistory(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  // --- render ------------------------------------------------------------------

  const vaultName = vaultPath ? baseName(vaultPath) : 'No vault'
  const noteCount = index?.notes.length ?? 0

  if (!vaultPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        {vaults === null ? (
          <Spinner />
        ) : (
          <>
            <NotebookText className="size-8 opacity-60" />
            <p className="max-w-sm text-center">
              No Obsidian vault found. Open a folder as a vault — Relay reads and writes the same Markdown files Obsidian does.
            </p>
            <Button onClick={() => void pickVaultFolder()}>
              <FolderOpen className="size-4" /> Open folder as vault…
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-background" onKeyDown={onKeyDown}>
      {/* Left: vault navigation */}
      <aside className="flex w-[250px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
          <button
            type="button"
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] font-medium hover:bg-accent"
            onClick={(e) => menu.openBelow(vaultMenu(), e.currentTarget)}
            title={vaultPath}
          >
            <Vault className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{vaultName}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
          <IconButton label="New note" onClick={() => void newNote()}>
            <FilePlus className="size-3.5" />
          </IconButton>
          <IconButton label="Open today's daily note" onClick={() => void openDailyNote()}>
            <CalendarDays className="size-3.5" />
          </IconButton>
          <IconButton label="Graph view" active={mode === 'graph'} onClick={() => setMode((m) => (m === 'graph' ? 'note' : 'graph'))}>
            <Network className="size-3.5" />
          </IconButton>
        </div>
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
          <IconButton label="Files" className="size-6" active={panel === 'files'} onClick={() => setPanel('files')}>
            <FileText className="size-3.5" />
          </IconButton>
          <IconButton label="Search" className="size-6" active={panel === 'search'} onClick={() => setPanel('search')}>
            <Search className="size-3.5" />
          </IconButton>
          <IconButton label="Tags" className="size-6" active={panel === 'tags'} onClick={() => setPanel('tags')}>
            <Hash className="size-3.5" />
          </IconButton>
          <span className="flex-1 truncate px-1 text-right text-2xs text-muted-foreground">
            {index ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}
          </span>
          <IconButton label="Reindex vault" className="size-6" onClick={() => void reindex()}>
            <RefreshCw className="size-3" />
          </IconButton>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto py-1">
          {indexError ? (
            <p className="px-3 py-2 text-xs text-destructive">{indexError}</p>
          ) : !index ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : panel === 'files' ? (
            <FileTree
              folder={tree!}
              depth={0}
              current={notePath}
              expanded={expanded}
              onToggle={(path) =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(path)) {
                    next.delete(path)
                  } else {
                    next.add(path)
                  }
                  return next
                })
              }
              onOpen={(path) => openNote(path)}
              onContext={(path, e) => menu.openAt(noteMenu(path), { x: e.clientX, y: e.clientY })}
            />
          ) : panel === 'search' ? (
            <VaultSearch vaultPath={vaultPath} onOpen={(path, line) => openNote(path, { line })} />
          ) : (
            <TagList tags={graph.tags} selected={selectedTag} onSelect={setSelectedTag} onOpen={(path) => openNote(path)} />
          )}
        </div>
      </aside>

      {/* Center: note or graph */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
          <IconButton label="Back (Ctrl+Alt+←)" disabled={history.index <= 0} onClick={() => goHistory(-1)}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <IconButton label="Forward (Ctrl+Alt+→)" disabled={history.index >= history.stack.length - 1} onClick={() => goHistory(1)}>
            <ArrowRight className="size-4" />
          </IconButton>
          {mode === 'graph' ? (
            <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium">Graph view · {noteCount} notes</span>
          ) : notePath ? (
            <div className="flex min-w-0 flex-1 items-center gap-1 px-1">
              {folderOf(notePath) ? <span className="shrink-0 truncate text-xs text-muted-foreground">{folderOf(notePath)} /</span> : null}
              <input
                ref={titleRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void renameNote()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    setTitleDraft(noteTitle(notePath))
                    setTimeout(() => e.currentTarget?.blur())
                  }
                }}
                spellCheck={false}
                title="Rename note"
                className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13px] font-medium outline-none hover:bg-accent/50 focus:bg-accent/50"
              />
              {dirty ? <span className="text-xs text-muted-foreground">●</span> : null}
            </div>
          ) : (
            <span className="flex-1" />
          )}
          {mode === 'note' && notePath ? (
            <>
              <div className="flex rounded-md border border-border p-0.5">
                {(
                  [
                    ['read', BookOpen, 'Reading view'],
                    ['edit', PenLine, 'Editing view'],
                    ['split', Columns2, 'Edit and preview side by side']
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button
                    key={id}
                    type="button"
                    title={`${label}${id !== 'split' ? ' (Ctrl+E)' : ''}`}
                    onClick={() => setView(id)}
                    className={cn('flex h-6 w-7 items-center justify-center rounded', view === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => sendNote(notePath)} title="Send the note (or the selected text) to this workspace's agent">
                <Send className="size-3.5" /> Send to agent
              </Button>
              <IconButton label="Open in Obsidian" onClick={() => void window.relay.shell.openExternal(obsidianUri(absolutePath(vaultPath, notePath)))}>
                <ExternalLink className="size-3.5" />
              </IconButton>
              <IconButton label="More" onClick={(e) => menu.openBelow(noteMenu(notePath), e.currentTarget, 'end')}>
                <Ellipsis className="size-4" />
              </IconButton>
            </>
          ) : null}
          <IconButton label={rightOpen ? 'Hide note sidebar' : 'Show note sidebar'} onClick={() => setRightOpen((v) => !v)}>
            {rightOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </IconButton>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {mode === 'graph' ? (
            <NotesGraph nodes={graph.nodes} edges={graph.edges} activeId={notePath} visible={visible} onOpen={(path) => openNote(path)} />
          ) : !notePath ? (
            <VaultHome index={index} onOpen={(path) => openNote(path)} onNew={() => void newNote()} onDaily={() => void openDailyNote()} />
          ) : noteError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Unlink className="size-5" />
              <span>{noteError}</span>
            </div>
          ) : !note || note.path !== notePath ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <>
              {view !== 'read' ? (
                <div className={cn('min-h-0 min-w-0 bg-editor-surface', view === 'split' ? 'w-1/2 border-r border-border' : 'flex-1')}>
                  <Editor
                    path={monaco.Uri.file(absolutePath(vaultPath, note.path)).toString()}
                    defaultValue={note.text}
                    defaultLanguage="markdown"
                    keepCurrentModel
                    theme={isDark ? 'relay-dark' : 'relay-light'}
                    onMount={onEditorMount}
                    onChange={(value) => onEdit(value ?? '')}
                    options={{
                      fontSize: (settings?.editorFontSize ?? 13) + 1,
                      lineHeight: 22,
                      fontFamily: "'Geist', -apple-system, 'Segoe UI', sans-serif",
                      wordWrap: 'on',
                      lineNumbers: 'off',
                      glyphMargin: false,
                      folding: true,
                      minimap: { enabled: false },
                      renderLineHighlight: 'none',
                      occurrencesHighlight: 'off',
                      quickSuggestions: false,
                      wordBasedSuggestions: 'off',
                      scrollBeyondLastLine: false,
                      smoothScrolling: true,
                      automaticLayout: true,
                      padding: { top: 16, bottom: 16 }
                    }}
                  />
                </div>
              ) : null}
              {view !== 'edit' ? (
                <div className="scrollbar-sleek min-h-0 min-w-0 flex-1 overflow-auto">
                  <article className="markdown-preview mx-auto max-w-[760px] px-10 py-8">
                    <h1 className="md-inline-title">{noteTitle(note.path)}</h1>
                    {properties.length ? (
                      <PropertiesTable
                        properties={properties}
                        onTag={(tag) => {
                          setSelectedTag(tag)
                          setPanel('tags')
                        }}
                      />
                    ) : null}
                    <div ref={previewRef} onClick={onPreviewClick} dangerouslySetInnerHTML={htmlProp} />
                  </article>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* Right: outline, backlinks, outgoing links */}
      {rightOpen && notePath && mode === 'note' ? (
        <NoteSidebar
          vaultPath={vaultPath}
          notePath={notePath}
          note={note}
          headings={headings}
          graph={graph}
          onOpen={(path) => openNote(path)}
          onHeading={(heading) => {
            pendingHeading.current = heading
            scrollToTarget()
          }}
          onFollow={followLink}
        />
      ) : null}
      {menu.render()}
    </div>
  )
}

function FileTree({
  folder,
  depth,
  current,
  expanded,
  onToggle,
  onOpen,
  onContext
}: {
  folder: FolderNode
  depth: number
  current: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onContext: (path: string, event: React.MouseEvent) => void
}): ReactNode {
  const pad = { paddingLeft: 8 + depth * 12 }
  // Folders with thousands of notes mount in pages so expanding one doesn't stall the UI.
  const [limit, setLimit] = useState(TREE_PAGE)
  return (
    <>
      {folder.folders.map((child) => {
        const open = expanded.has(child.path)
        return (
          <div key={child.path}>
            <button type="button" style={pad} className="flex h-6 w-full items-center gap-1 pr-2 text-left text-[13px] hover:bg-sidebar-accent" onClick={() => onToggle(child.path)}>
              {open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{child.name}</span>
            </button>
            {open ? <FileTree folder={child} depth={depth + 1} current={current} expanded={expanded} onToggle={onToggle} onOpen={onOpen} onContext={onContext} /> : null}
          </div>
        )
      })}
      {folder.notes.slice(0, limit).map((note) => (
        <button
          key={note.path}
          type="button"
          style={{ paddingLeft: 8 + depth * 12 + 16 }}
          className={cn('flex h-6 w-full items-center pr-2 text-left text-[13px]', note.path === current ? 'bg-sidebar-accent font-medium' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/70')}
          onClick={() => onOpen(note.path)}
          onContextMenu={(e) => {
            e.preventDefault()
            onContext(note.path, e)
          }}
          title={note.path}
        >
          <span className="truncate">{note.title}</span>
        </button>
      ))}
      {folder.notes.length > limit ? (
        <button
          type="button"
          style={{ paddingLeft: 8 + depth * 12 + 16 }}
          className="flex h-6 w-full items-center pr-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
          onClick={() => setLimit((n) => n + TREE_PAGE)}
        >
          Show {Math.min(TREE_PAGE, folder.notes.length - limit)} more of {folder.notes.length - limit}
        </button>
      ) : null}
    </>
  )
}

function VaultSearch({ vaultPath, onOpen }: { vaultPath: string; onOpen: (path: string, line?: number) => void }): ReactNode {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setBusy(true)
      void window.relay.obsidian.search(vaultPath, query, 300).then(
        (matches) => {
          if (!cancelled) {
            setResults(matches)
            setBusy(false)
          }
        },
        () => !cancelled && setBusy(false)
      )
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, vaultPath])

  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>()
    for (const match of results ?? []) {
      map.set(match.filePath, [...(map.get(match.filePath) ?? []), match])
    }
    return [...map.entries()]
  }, [results])

  return (
    <div className="flex flex-col gap-1 px-2">
      <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" className="h-7 text-xs" />
      {busy ? <Spinner className="mx-auto my-2 size-3.5" /> : null}
      {results && !grouped.length && !busy ? <p className="px-1 py-2 text-xs text-muted-foreground">No matches.</p> : null}
      {grouped.map(([path, matches]) => (
        <div key={path} className="py-1">
          <button type="button" className="w-full truncate rounded px-1 text-left text-[13px] font-medium hover:bg-sidebar-accent" onClick={() => onOpen(path)} title={path}>
            {noteTitle(path)}
          </button>
          {matches
            .filter((m) => m.line > 0)
            .slice(0, 4)
            .map((match) => (
              <button
                key={match.line}
                type="button"
                className="block w-full truncate rounded px-1 pl-3 text-left text-2xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                onClick={() => onOpen(path, match.line)}
              >
                {match.text}
              </button>
            ))}
        </div>
      ))}
    </div>
  )
}

function TagList({
  tags,
  selected,
  onSelect,
  onOpen
}: {
  tags: Map<string, string[]>
  selected: string | null
  onSelect: (tag: string | null) => void
  onOpen: (path: string) => void
}): ReactNode {
  const sorted = [...tags.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  if (!sorted.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No #tags in this vault yet.</p>
  }
  return (
    <div className="flex flex-col">
      {sorted.map(([tag, paths]) => (
        <div key={tag}>
          <button
            type="button"
            className={cn('flex h-6 w-full items-center gap-1.5 px-2 text-left text-[13px] hover:bg-sidebar-accent', selected === tag && 'bg-sidebar-accent font-medium')}
            onClick={() => onSelect(selected === tag ? null : tag)}
          >
            <Hash className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{tag}</span>
            <span className="text-2xs text-muted-foreground">{paths.length}</span>
          </button>
          {selected === tag
            ? paths.map((path) => (
                <button key={path} type="button" className="block h-6 w-full truncate pr-2 pl-7 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" onClick={() => onOpen(path)}>
                  {noteTitle(path)}
                </button>
              ))
            : null}
        </div>
      ))}
    </div>
  )
}

function PropertiesTable({ properties, onTag }: { properties: ReturnType<typeof parseProperties>; onTag: (tag: string) => void }): ReactNode {
  return (
    <div className="md-properties">
      {properties.map((property) => (
        <div key={property.key} className="flex gap-3 py-0.5 text-xs">
          <span className="w-28 shrink-0 truncate text-muted-foreground">{property.key}</span>
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {Array.isArray(property.value) ? (
              property.value.map((value) =>
                /^tags?$/i.test(property.key) ? (
                  <button key={value} type="button" className="md-tag" onClick={() => onTag(value.replace(/^#/, ''))}>
                    #{value.replace(/^#/, '')}
                  </button>
                ) : (
                  <span key={value} className="rounded bg-muted px-1.5">
                    {value}
                  </span>
                )
              )
            ) : (
              <span className="break-words">{property.value}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function VaultHome({ index, onOpen, onNew, onDaily }: { index: VaultIndex | null; onOpen: (path: string) => void; onNew: () => void; onDaily: () => void }): ReactNode {
  const recent = useMemo(() => [...(index?.notes ?? [])].sort((a, b) => b.mtime - a.mtime).slice(0, 10), [index])
  return (
    <div className="scrollbar-sleek flex flex-1 justify-center overflow-auto">
      <div className="w-full max-w-md px-6 py-12">
        <div className="mb-4 flex gap-2">
          <Button onClick={onNew}>
            <FilePlus className="size-4" /> New note
          </Button>
          <Button variant="outline" onClick={onDaily}>
            <CalendarDays className="size-4" /> Today's note
          </Button>
        </div>
        {recent.length ? (
          <>
            <h3 className="mb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">Recently edited</h3>
            {recent.map((note) => (
              <button key={note.path} type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-accent" onClick={() => onOpen(note.path)}>
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{note.title}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">{new Date(note.mtime).toLocaleDateString()}</span>
              </button>
            ))}
          </>
        ) : index ? (
          <p className="text-xs text-muted-foreground">This vault has no notes yet.</p>
        ) : null}
      </div>
    </div>
  )
}

function SidebarSection({ title, icon, count, children }: { title: string; icon: ReactNode; count?: number; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(true)
  return (
    <div className="border-b border-border py-1 last:border-0">
      <button type="button" className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-2xs font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="[&>svg]:size-3">{icon}</span>
        <span className="flex-1">{title}</span>
        {count !== undefined ? <span className="font-normal normal-case">{count}</span> : null}
      </button>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  )
}

function NoteSidebar({
  vaultPath,
  notePath,
  note,
  headings,
  graph,
  onOpen,
  onHeading,
  onFollow
}: {
  vaultPath: string
  notePath: string
  note: { path: string; text: string } | null
  headings: ReturnType<typeof parseNote>['headings']
  graph: VaultGraph
  onOpen: (path: string) => void
  onHeading: (heading: string) => void
  onFollow: (target: string, resolved: string, heading: string) => void
}): ReactNode {
  const backlinks = graph.backlinks.get(notePath) ?? []
  const [snippets, setSnippets] = useState<Record<string, string[]>>({})

  // Show where each backlink mentions this note, like Obsidian's backlinks pane.
  useEffect(() => {
    let cancelled = false
    const title = noteTitle(notePath).toLowerCase()
    void Promise.all(
      backlinks.slice(0, 40).map(async (source) => {
        const content = await window.relay.fs.readFile(absolutePath(vaultPath, source)).catch(() => null)
        if (!content || content.kind !== 'text') {
          return [source, []] as const
        }
        const lines = content.content
          .split(/\r?\n/)
          .filter((line) => line.toLowerCase().includes(title) && /\[\[|\]\(/.test(line))
          .slice(0, 2)
          .map((line) => line.trim().slice(0, 200))
        return [source, lines] as const
      })
    ).then((entries) => {
      if (!cancelled) {
        setSnippets(Object.fromEntries(entries))
      }
    })
    return () => {
      cancelled = true
    }
    // The backlink list is derived from the graph; recompute when it or the note changes.
  }, [graph, notePath, vaultPath])

  const outgoing = useMemo(() => {
    if (!note) {
      return { resolved: [] as string[], unresolved: [] as string[] }
    }
    const parsed = parseNote(note.text)
    const resolved = new Set<string>()
    const unresolved = new Set<string>()
    for (const link of [...parsed.links, ...parsed.embeds]) {
      const target = graph.resolve(link, note.path)
      if (target) {
        if (target !== note.path) {
          resolved.add(target)
        }
      } else {
        unresolved.add(link)
      }
    }
    return { resolved: [...resolved], unresolved: [...unresolved] }
  }, [note, graph])

  const minLevel = Math.min(...headings.map((h) => h.level), 6)

  return (
    <aside className="scrollbar-sleek flex w-[250px] shrink-0 flex-col overflow-auto border-l border-border bg-sidebar">
      <SidebarSection title="Outline" icon={<ListTree />} count={headings.length}>
        {headings.length ? (
          headings.map((heading, i) => (
            <button
              key={`${heading.line}-${i}`}
              type="button"
              style={{ paddingLeft: 12 + (heading.level - minLevel) * 12 }}
              className="block h-6 w-full truncate pr-2 text-left text-xs hover:bg-sidebar-accent"
              onClick={() => onHeading(heading.text)}
            >
              {heading.text}
            </button>
          ))
        ) : (
          <p className="px-3 text-xs text-muted-foreground">No headings.</p>
        )}
      </SidebarSection>
      <SidebarSection title="Backlinks" icon={<Link2 />} count={backlinks.length}>
        {backlinks.length ? (
          backlinks.map((source) => (
            <button key={source} type="button" className="block w-full px-3 py-1 text-left hover:bg-sidebar-accent" onClick={() => onOpen(source)}>
              <span className="block truncate text-xs font-medium">{noteTitle(source)}</span>
              {(snippets[source] ?? []).map((line, i) => (
                <span key={i} className="mt-0.5 line-clamp-2 block text-2xs text-muted-foreground">
                  {line}
                </span>
              ))}
            </button>
          ))
        ) : (
          <p className="px-3 text-xs text-muted-foreground">No notes link here.</p>
        )}
      </SidebarSection>
      <SidebarSection title="Outgoing links" icon={<ExternalLink />} count={outgoing.resolved.length + outgoing.unresolved.length}>
        {outgoing.resolved.map((path) => (
          <button key={path} type="button" className="block h-6 w-full truncate px-3 text-left text-xs hover:bg-sidebar-accent" onClick={() => onOpen(path)} title={path}>
            {noteTitle(path)}
          </button>
        ))}
        {outgoing.unresolved.map((target) => (
          <button
            key={target}
            type="button"
            className="block h-6 w-full truncate px-3 text-left text-xs text-muted-foreground italic hover:bg-sidebar-accent"
            title="Not created yet — click to create"
            onClick={() => onFollow(target, '', '')}
          >
            {target}
          </button>
        ))}
        {!outgoing.resolved.length && !outgoing.unresolved.length ? <p className="px-3 text-xs text-muted-foreground">No links.</p> : null}
      </SidebarSection>
    </aside>
  )
}
