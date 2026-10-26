import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKSPACE_NAMES, normalizeWorkspaceName, suggestWorkspaceName } from '../src/shared/workspace-names.ts'

test('normalizeWorkspaceName produces a branch- and folder-safe slug', () => {
  assert.equal(normalizeWorkspaceName('  Fix Login Bug!! '), 'fix-login-bug')
  assert.equal(normalizeWorkspaceName('feat/new  thing'), 'feat-new-thing')
  assert.equal(normalizeWorkspaceName('..hidden--name..'), 'hidden-name')
  assert.equal(normalizeWorkspaceName('v1.2_rc'), 'v1.2_rc')
})

test('generated names are already normalized and unique', () => {
  assert.equal(new Set(WORKSPACE_NAMES).size, WORKSPACE_NAMES.length)
  for (const name of WORKSPACE_NAMES) {
    assert.equal(normalizeWorkspaceName(name), name)
    assert.match(name, /^[a-z]+-[a-z]+$/)
  }
})

test('suggestWorkspaceName skips used names, case-insensitively', () => {
  const used = WORKSPACE_NAMES.slice(1).map((name) => name.toUpperCase())
  assert.equal(suggestWorkspaceName(used, () => 0.5), WORKSPACE_NAMES[0])
})

test('suggestWorkspaceName falls back to suffixed tiers once the pool is spent', () => {
  const used = [...WORKSPACE_NAMES]
  assert.equal(suggestWorkspaceName(used, () => 0), `${used[0]}-2`)
  const tierTwo = used.map((name) => `${name}-2`)
  assert.equal(suggestWorkspaceName([...used, ...tierTwo], () => 0), `${used[0]}-3`)
})
