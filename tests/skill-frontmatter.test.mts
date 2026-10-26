import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adaptedSkillName, parseSkillFrontmatter, renameSkillFrontmatter } from '../src/shared/skill-frontmatter.ts'

test('reads plain values and skips nested maps', () => {
  const text = [
    '---',
    'name: reverse-engineer-anything',
    'description: Reverse engineer native, managed, Electron/JavaScript targets.',
    'metadata:',
    '  version: "42"',
    '  tool_count: 207',
    'license: Proprietary. LICENSE.txt has complete terms',
    '---',
    '',
    '# Body'
  ].join('\n')
  assert.deepEqual(parseSkillFrontmatter(text), {
    name: 'reverse-engineer-anything',
    description: 'Reverse engineer native, managed, Electron/JavaScript targets.',
    license: 'Proprietary. LICENSE.txt has complete terms'
  })
})

test('reads quoted, folded, literal and wrapped values with CRLF', () => {
  const text = [
    '---',
    'name: "quoted \\"name\\""',
    "alias: 'it''s'",
    'description: >',
    '  Folded line one',
    '  and line two.',
    'notes: |',
    '  keep',
    '  lines',
    'wrapped: starts here',
    '  and continues',
    '---',
    'body'
  ].join('\r\n')
  assert.deepEqual(parseSkillFrontmatter(text), {
    name: 'quoted "name"',
    alias: "it's",
    description: 'Folded line one and line two.',
    notes: 'keep\nlines',
    wrapped: 'starts here and continues'
  })
})

test('no frontmatter yields nothing', () => {
  assert.deepEqual(parseSkillFrontmatter('# Just markdown\nname: not frontmatter'), {})
})

test('renameSkillFrontmatter replaces only the frontmatter name', () => {
  const text = '---\nname: pdf\ndescription: PDFs\n---\n\nname: pdf stays in the body\n'
  assert.equal(renameSkillFrontmatter(text, 'pdf-local'), '---\nname: pdf-local\ndescription: PDFs\n---\n\nname: pdf stays in the body\n')
})

test('renameSkillFrontmatter adds a name or a whole block when missing', () => {
  assert.equal(renameSkillFrontmatter('---\ndescription: x\n---\nbody', 'a-local'), '---\nname: a-local\ndescription: x\n---\nbody')
  assert.equal(renameSkillFrontmatter('body', 'a-local'), '---\nname: a-local\n---\n\nbody')
})

test('adapted copies get a distinct name', () => {
  assert.equal(adaptedSkillName('hyperframes'), 'hyperframes-local')
})
