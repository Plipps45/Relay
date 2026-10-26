import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatResetIn, formatTokens, parseUsageLine, sumTokens } from '../src/shared/claude-usage.ts'

const line = (id: string, requestId: string, timestamp: string): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    requestId,
    message: { id, role: 'assistant', usage: { input_tokens: 2, output_tokens: 100, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000 } }
  })

test('parses assistant usage lines and ignores the rest', () => {
  const entry = parseUsageLine(line('msg_1', 'req_1', '2026-10-26T10:00:00.000Z'))
  assert.deepEqual(entry, { key: 'msg_1:req_1', ts: Date.parse('2026-10-26T10:00:00.000Z'), input: 2, output: 100, cacheWrite: 300, cacheRead: 4000 })
  assert.equal(parseUsageLine('{"type":"user","message":{"role":"user","content":"hi"}}'), null)
  assert.equal(parseUsageLine('{"type":"assistant","usage" broken'), null)
})

test('sums entries since a cutoff', () => {
  const a = parseUsageLine(line('a', 'r', '2026-10-26T08:00:00.000Z'))!
  const b = parseUsageLine(line('b', 'r', '2026-10-26T12:00:00.000Z'))!
  const totals = sumTokens([a, b], Date.parse('2026-10-26T10:00:00.000Z'))
  assert.deepEqual(totals, { input: 2, output: 100, cacheWrite: 300, cacheRead: 4000, total: 4402 })
})

test('formats token counts and reset times', () => {
  assert.equal(formatTokens(950), '950')
  assert.equal(formatTokens(1500), '1.5k')
  assert.equal(formatTokens(2_000_000), '2M')
  assert.equal(formatTokens(123_456_789), '123M')
  assert.equal(formatResetIn(45 * 60_000, 0), '45m')
  assert.equal(formatResetIn(134 * 60_000, 0), '2h 14m')
  assert.equal(formatResetIn(63 * 3_600_000, 0), '2d 15h')
  assert.equal(formatResetIn(null, 0), '')
})
