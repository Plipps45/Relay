import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from 'node:path'
import { parseStatusV2, parseWorktreeList } from '../src/main/git.ts'

test('parseWorktreeList reads main, linked, detached and bare entries', () => {
  const output = [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /ws/repo/amber-beacon',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/me/amber-beacon',
    '',
    'worktree /ws/repo/krill',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /bare.git',
    'bare',
    ''
  ].join('\n')
  const entries = parseWorktreeList(output)
  assert.equal(entries.length, 4)
  assert.deepEqual(entries[0], { path: normalize('/repo'), head: '1'.repeat(40), branch: 'main', bare: false, detached: false, prunable: false })
  assert.equal(entries[1].branch, 'me/amber-beacon')
  assert.equal(entries[2].detached, true)
  assert.equal(entries[2].prunable, true)
  assert.equal(entries[2].branch, null)
  assert.equal(entries[3].bare, true)
})

test('parseWorktreeList tolerates CRLF', () => {
  const entries = parseWorktreeList('worktree C:/repo\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\n')
  assert.equal(entries[0].branch, 'main')
  assert.equal(entries[0].head, 'abc')
})

test('parseStatusV2 reads branch, ahead/behind and every record kind', () => {
  const records = [
    '# branch.oid 1111111111111111111111111111111111111111',
    '# branch.head me/amber-beacon',
    '# branch.upstream origin/me/amber-beacon',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/app file.ts',
    '1 A. N... 000000 100644 100644 000 ccc added.ts',
    '2 R. N... 100644 100644 100644 ddd eee R100 renamed.ts',
    'original.ts',
    'u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.ts',
    '? notes.txt',
    ''
  ]
  const status = parseStatusV2(records.join('\0'))
  assert.equal(status.branch, 'me/amber-beacon')
  assert.equal(status.upstream, 'origin/me/amber-beacon')
  assert.equal(status.ahead, 2)
  assert.equal(status.behind, 1)
  assert.equal(status.files.length, 5)

  const [modified, added, renamed, conflict, untracked] = status.files
  assert.equal(modified.path, 'src/app file.ts', 'paths with spaces survive the split')
  assert.equal(modified.staged, false)
  assert.equal(modified.unstaged, true)
  assert.equal(added.staged, true)
  assert.equal(renamed.path, 'renamed.ts')
  assert.equal(renamed.oldPath, 'original.ts')
  assert.equal(conflict.conflicted, true)
  assert.equal(untracked.untracked, true)
})

test('parseStatusV2 maps a detached head to null', () => {
  assert.equal(parseStatusV2('# branch.head (detached)\0').branch, null)
})
