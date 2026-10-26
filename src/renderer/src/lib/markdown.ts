import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import { linkTarget } from '@shared/obsidian'
import { monaco } from './monaco'

export type RenderOptions = {
  /** Resolves a link target to a vault-relative path, or null when it doesn't exist. */
  resolve: (target: string) => string | null
  /** Embedded notes render their own embeds as plain links, so a note can't embed itself forever. */
  allowEmbeds: boolean
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

// Marked extensions are configured once; the active note's options are swapped in per render.
let current: RenderOptions = { resolve: () => null, allowEmbeds: true }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

function splitLink(inner: string): { target: string; heading: string; alias: string | null } {
  // Inside tables Obsidian escapes the alias pipe as \|.
  const [ref, ...rest] = inner.replace(/\\\|/g, '|').split('|')
  const hash = ref.indexOf('#')
  return {
    target: linkTarget(ref),
    heading: hash === -1 ? '' : ref.slice(hash + 1).replace(/^\^/, '').trim(),
    alias: rest.length ? rest.join('|').trim() : null
  }
}

function wikilinkHtml(inner: string): string {
  const { target, heading, alias } = splitLink(inner)
  const resolved = target ? current.resolve(target) : null
  const label = alias || (target && heading ? `${target} › ${heading}` : target || heading)
  const unresolved = target !== '' && !resolved
  return `<a class="md-wikilink${unresolved ? ' is-unresolved' : ''}" data-target="${escapeHtml(target)}" data-path="${escapeHtml(resolved ?? '')}" data-heading="${escapeHtml(heading)}">${escapeHtml(label)}</a>`
}

const marked = new Marked({ gfm: true, breaks: true })

marked.use({
  extensions: [
    {
      name: 'embed',
      level: 'inline',
      start: (src: string) => {
        const index = src.indexOf('![[')
        return index === -1 ? undefined : index
      },
      tokenizer(src: string) {
        const match = /^!\[\[([^\]\n]+?)\]\]/.exec(src)
        return match ? { type: 'embed', raw: match[0], inner: match[1] } : undefined
      },
      renderer(token: Tokens.Generic) {
        const inner = String(token.inner)
        const { target, heading, alias } = splitLink(inner)
        const resolved = current.resolve(target)
        if (!resolved || !current.allowEmbeds) {
          return wikilinkHtml(inner)
        }
        if (IMAGE_EXT.test(resolved)) {
          // `![[image.png|300]]` or `|300x200` sets the size.
          const size = /^(\d+)(?:x(\d+))?$/.exec(alias ?? '')
          const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : ''
          return `<img class="md-embed-image" data-src="${escapeHtml(resolved)}" alt="${escapeHtml(alias && !size ? alias : target)}"${dims}>`
        }
        if (/\.md$/i.test(resolved)) {
          return `<span class="md-embed-note" data-path="${escapeHtml(resolved)}" data-heading="${escapeHtml(heading)}"></span>`
        }
        return wikilinkHtml(inner)
      }
    },
    {
      name: 'wikilink',
      level: 'inline',
      start: (src: string) => {
        const index = src.indexOf('[[')
        return index === -1 ? undefined : index
      },
      tokenizer(src: string) {
        const match = /^\[\[([^\]\n]+?)\]\]/.exec(src)
        return match ? { type: 'wikilink', raw: match[0], inner: match[1] } : undefined
      },
      renderer(token: Tokens.Generic) {
        return wikilinkHtml(String(token.inner))
      }
    },
    {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => {
        const index = src.indexOf('==')
        return index === -1 ? undefined : index
      },
      tokenizer(src: string) {
        const match = /^==(?=\S)([^\n]*?\S)==/.exec(src)
        if (!match) {
          return undefined
        }
        return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) }
      },
      renderer(token: Tokens.Generic) {
        return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`
      },
      childTokens: ['tokens']
    },
    {
      name: 'tag',
      level: 'inline',
      start: (src: string) => {
        // Only a `#` at a word start begins a tag; `a#b` and URL fragments don't.
        const match = /(^|\s)#[\p{L}\p{N}_/-]/u.exec(src)
        return match ? match.index + match[1].length : undefined
      },
      tokenizer(src: string) {
        const match = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src)
        return match ? { type: 'tag', raw: match[0], tag: match[1] } : undefined
      },
      renderer(token: Tokens.Generic) {
        const tag = escapeHtml(String(token.tag))
        return `<a class="md-tag" data-tag="${tag}">#${tag}</a>`
      }
    }
  ]
})

const CALLOUT_ICONS: Record<string, string> = {
  note: '✎', abstract: '☰', summary: '☰', tldr: '☰', info: 'ℹ', todo: '☑', tip: '🔥', hint: '🔥', important: '🔥',
  success: '✓', check: '✓', done: '✓', question: '?', help: '?', faq: '?', warning: '⚠', caution: '⚠', attention: '⚠',
  failure: '✗', fail: '✗', missing: '✗', danger: '⚡', error: '⚡', bug: '🐞', example: '≡', quote: '❝', cite: '❝'
}

/** `> [!type]± Title` blockquotes become Obsidian callouts. */
function renderCallouts(root: HTMLElement): void {
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    const first = quote.firstElementChild
    if (!first || first.tagName !== 'P') {
      continue
    }
    const match = /^\[!([\w-]+)\]([+-]?)[ \t]*/.exec(first.innerHTML)
    if (!match) {
      continue
    }
    const type = match[1].toLowerCase()
    const rest = first.innerHTML.slice(match[0].length)
    const breakAt = rest.search(/<br>|\n/)
    const titleHtml = breakAt === -1 ? rest : rest.slice(0, breakAt)
    const bodyHtml = breakAt === -1 ? '' : rest.slice(breakAt).replace(/^(<br>|\n)+/, '')

    const callout = document.createElement(match[2] ? 'details' : 'div')
    callout.className = 'callout'
    callout.dataset.callout = type
    if (match[2] === '+') {
      callout.setAttribute('open', '')
    }
    const title = document.createElement(match[2] ? 'summary' : 'div')
    title.className = 'callout-title'
    title.innerHTML = `<span class="callout-icon">${CALLOUT_ICONS[type] ?? '✎'}</span><span>${titleHtml.trim() || escapeHtml(type.charAt(0).toUpperCase() + type.slice(1))}</span>`
    const content = document.createElement('div')
    content.className = 'callout-content'
    if (bodyHtml.trim()) {
      first.innerHTML = bodyHtml
    } else {
      first.remove()
    }
    content.append(...quote.childNodes)
    callout.append(title, content)
    quote.replaceWith(callout)
  }
}

/** Markdown (frontmatter already removed) → sanitized HTML with Obsidian syntax. */
export function renderMarkdown(body: string, options: RenderOptions): string {
  const source = body
    .replace(/%%[\s\S]*?%%/g, '') // Obsidian comments
    .replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm, '') // block ids
  current = options
  let html: string
  try {
    html = marked.parse(source, { async: false })
  } finally {
    current = { resolve: () => null, allowEmbeds: true }
  }
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ['details', 'summary'], FORBID_TAGS: ['style', 'form'] })
  const root = template.content as unknown as HTMLElement
  renderCallouts(root)
  root.querySelectorAll('input[type="checkbox"]').forEach((box, index) => {
    box.removeAttribute('disabled')
    box.setAttribute('data-task', String(index))
    const item = box.closest('li')
    item?.classList.add('task-list-item')
    if (box.hasAttribute('checked')) {
      item?.classList.add('is-checked')
    }
  })
  root.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (!/^(https?:|data:)/i.test(src)) {
      img.removeAttribute('src')
      img.setAttribute('data-src', src)
      img.classList.add('md-embed-image')
    }
  })
  const wrapper = document.createElement('div')
  wrapper.append(root)
  return wrapper.innerHTML
}

/** Syntax-highlights fenced code blocks in place using Monaco's tokenizer. */
export async function colorizeCodeBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')].filter((code) => !code.dataset.colorized)
  if (blocks.length) {
    // colorize() uses the global theme, which no editor may have set yet.
    monaco.editor.setTheme(dark ? 'relay-dark' : 'relay-light')
  }
  for (const code of blocks) {
    code.dataset.colorized = '1'
    const language = /language-([\w+#-]+)/.exec(code.className)?.[1]?.toLowerCase() ?? ''
    const known = monaco.languages.getLanguages().find((l) => l.id === language || l.aliases?.some((a) => a.toLowerCase() === language))
    if (!known) {
      continue
    }
    try {
      code.innerHTML = await monaco.editor.colorize(code.textContent ?? '', known.id, { tabSize: 2 })
    } catch {
      // Unhighlighted code is still readable.
    }
  }
}
