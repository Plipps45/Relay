import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewerVersion } from '../src/shared/version.ts'

test('isNewerVersion compares numeric parts, not strings', () => {
  assert.equal(isNewerVersion('0.1.10', '0.1.9'), true)
  assert.equal(isNewerVersion('0.2.0', '0.1.9'), true)
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true)
  assert.equal(isNewerVersion('0.1.1', '0.1.1'), false)
  assert.equal(isNewerVersion('0.1.0', '0.1.1'), false)
})

test('isNewerVersion accepts tag prefixes and missing parts', () => {
  assert.equal(isNewerVersion('v0.1.2', '0.1.1'), true)
  assert.equal(isNewerVersion('v0.2', '0.1.9'), true)
  assert.equal(isNewerVersion('v0.1', '0.1.0'), false)
})

test('isNewerVersion rejects tags that are not versions', () => {
  assert.equal(isNewerVersion('nightly', '0.1.1'), false)
  assert.equal(isNewerVersion('', '0.1.1'), false)
})
