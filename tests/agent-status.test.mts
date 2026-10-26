import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanAgentTitle, createAgentStatusTracker, detectAgentStatusFromTitle, titleHasAgentName } from '../src/shared/agent-status.ts'

test('claude: spinner means working, ✳ means idle', () => {
  assert.equal(detectAgentStatusFromTitle('⠋ Claude Code'), 'working')
  assert.equal(detectAgentStatusFromTitle('◐ Claude Code'), 'working')
  assert.equal(detectAgentStatusFromTitle('✳ Claude Code'), 'idle')
})

test('gemini glyphs', () => {
  assert.equal(detectAgentStatusFromTitle('✦ Gemini'), 'working')
  assert.equal(detectAgentStatusFromTitle('⏲ Gemini'), 'working')
  assert.equal(detectAgentStatusFromTitle('◇ Gemini'), 'idle')
  assert.equal(detectAgentStatusFromTitle('✋ Gemini'), 'permission')
})

test('keywords only count next to an agent name', () => {
  assert.equal(detectAgentStatusFromTitle('codex - working'), 'working')
  assert.equal(detectAgentStatusFromTitle('codex - ready'), 'idle')
  assert.equal(detectAgentStatusFromTitle('codex - action required'), 'permission')
  assert.equal(detectAgentStatusFromTitle('npm run build - working'), null)
})

test('agent names match whole tokens only', () => {
  assert.equal(titleHasAgentName('claude'), true)
  assert.equal(titleHasAgentName('C:\\tools\\codex.exe'), false)
  assert.equal(titleHasAgentName('codex.exe'), true)
  assert.equal(titleHasAgentName('~/codex/ready'), false)
  assert.equal(titleHasAgentName('opencode-blinker'), false)
  assert.equal(detectAgentStatusFromTitle('~/codex/ready'), null)
})

test('plain shell titles are not agents', () => {
  assert.equal(detectAgentStatusFromTitle('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), null)
  assert.equal(detectAgentStatusFromTitle(''), null)
})

test('cleanAgentTitle strips spinner frames', () => {
  assert.equal(cleanAgentTitle('⠋ Claude Code'), 'Claude Code')
  assert.equal(cleanAgentTitle('✳ Claude Code'), 'Claude Code')
  assert.equal(cleanAgentTitle('bash'), 'bash')
})

test('tracker reports working → idle edges and ignores transient titles mid-run', () => {
  const tracker = createAgentStatusTracker()
  assert.deepEqual(tracker.handleTitle('✳ Claude Code'), { status: 'idle', transition: null })
  assert.deepEqual(tracker.handleTitle('⠋ Claude Code').transition, { kind: 'became-working' })
  // A tool subprocess retitling the terminal must not read as the agent exiting.
  assert.deepEqual(tracker.handleTitle('git status'), { status: 'working', transition: null })
  assert.deepEqual(tracker.handleTitle('✳ Claude Code').transition, { kind: 'became-idle', status: 'idle' })
  assert.deepEqual(tracker.handleTitle('pwsh'), { status: null, transition: { kind: 'exited' } })
})

test('tracker reports permission as a finished turn', () => {
  const tracker = createAgentStatusTracker()
  tracker.handleTitle('✦ Gemini')
  assert.deepEqual(tracker.handleTitle('✋ Gemini').transition, { kind: 'became-idle', status: 'permission' })
})
