import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createResolver,
  formatDailyNote,
  parseNote,
  parseProperties,
  splitFrontmatter,
  toggleTask,
  uniqueNoteName
} from '../src/shared/obsidian.ts'

test('collects wikilinks, embeds, markdown links and tags outside code', () => {
  const text = [
    '# Title',
    'See [[Other Note|alias]] and [[Folder/Deep#Section]] plus [md](Some%20Note.md).',
    '![[diagram.png]] ![](img/photo.jpg) [web](https://example.com)',
    'Tags: #project #area/sub #2024 not#tag',
    '```',
    '[[Inside Code]] #nope',
    '```',
    'Inline `[[Also Code]]` here.'
  ].join('\n')
  const parsed = parseNote(text)
  assert.deepEqual(parsed.links.sort(), ['Folder/Deep', 'Other Note', 'Some Note.md'])
  assert.deepEqual(parsed.embeds.sort(), ['diagram.png', 'img/photo.jpg'])
  assert.deepEqual(parsed.tags.sort(), ['area/sub', 'project'])
  assert.deepEqual(parsed.headings, [{ level: 1, text: 'Title', line: 1 }])
})

test('reads tags and aliases from properties, and offsets heading lines', () => {
  const text = ['---', 'tags: [alpha, "#beta"]', 'aliases:', '  - Nick', '  - "Other name"', 'status: draft', '---', '## Body'].join('\n')
  const parsed = parseNote(text)
  assert.deepEqual(parsed.tags.sort(), ['alpha', 'beta'])
  assert.deepEqual(parsed.aliases, ['Nick', 'Other name'])
  assert.deepEqual(parsed.headings, [{ level: 2, text: 'Body', line: 8 }])
  const { frontmatter, body } = splitFrontmatter(text)
  assert.equal(body, '## Body')
  assert.deepEqual(parseProperties(frontmatter), [
    { key: 'tags', value: ['alpha', '#beta'] },
    { key: 'aliases', value: ['Nick', 'Other name'] },
    { key: 'status', value: 'draft' }
  ])
})

test('resolves links the way Obsidian does', () => {
  const resolve = createResolver(['Home.md', 'Projects/Plan.md', 'Archive/Plan.md', 'Archive/Old/Plan.md', 'assets/diagram.png', 'Projects/Sub/Notes.md'])
  assert.equal(resolve('home', 'Projects/Plan.md'), 'Home.md')
  // Same folder as the source wins, then the shortest path.
  assert.equal(resolve('Plan', 'Archive/x.md'), 'Archive/Plan.md')
  assert.equal(resolve('Plan', 'Home.md'), 'Archive/Plan.md')
  assert.equal(resolve('Old/Plan', 'Home.md'), 'Archive/Old/Plan.md')
  assert.equal(resolve('Projects/Plan.md', 'Home.md'), 'Projects/Plan.md')
  assert.equal(resolve('diagram.png', 'Home.md'), 'assets/diagram.png')
  assert.equal(resolve('Sub/Notes', 'Projects/Plan.md'), 'Projects/Sub/Notes.md')
  assert.equal(resolve('Missing', 'Home.md'), null)
})

test('toggles the nth task and skips tasks inside code blocks', () => {
  const text = ['- [ ] one', '```', '- [ ] fake', '```', '* [x] two', '1. [ ] three'].join('\n')
  assert.equal(toggleTask(text, 0).split('\n')[0], '- [x] one')
  assert.equal(toggleTask(text, 1).split('\n')[4], '* [ ] two')
  assert.equal(toggleTask(text, 2).split('\n')[5], '1. [x] three')
  assert.equal(toggleTask(text, 3), text)
})

test('picks free note names and formats daily notes', () => {
  assert.equal(uniqueNoteName('Untitled', '', ['Untitled.md', 'untitled 1.md']), 'Untitled 2.md')
  assert.equal(uniqueNoteName('Untitled', 'Inbox', ['Untitled.md']), 'Inbox/Untitled.md')
  const date = new Date(2026, 2, 7)
  assert.equal(formatDailyNote('', date), '2026-03-07')
  assert.equal(formatDailyNote('YYYY/MM/[Day] D', date), '2026/03/Day 7')
})

test('reads escaped table pipes in wikilinks', () => {
  assert.deepEqual(parseNote('| [[Roadmap\\|alias]] | x |').links, ['Roadmap'])
})
