// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { visionBenchTool } from '../../bench-tool.mjs'
import { executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'
import { postEvidence } from '../../src/ui/common/agent-reference.mjs'

const exec = { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } }

/** @param {any} payload */
function host(payload) {
  return executeVisionCommand({
    home: '/tmp/unused-query-values',
    cwd: '/tmp/proj',
    sessionId: 's1',
    source: 'agent',
    action: payload.action,
    payload,
  })
}

test('invalid view value names the value and the allowed set', async () => {
  const tool = visionBenchTool('/tmp/unused-query-values')
  for (const ran of [
    await tool.execute({ action: 'points', op: 'list', view: 'compact' }, exec),
    await host({ action: 'points', op: 'list', view: 'compact' }),
  ]) {
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'INVALID_FIELD')
    assert.equal(ran.error, 'view 取值无效：compact；合法值 full / summary')
    assert.equal(ran.details.reason, 'INVALID_VALUE')
    assert.deepEqual(ran.details.allowedValues, ['full', 'summary'])
    assert.ok(ran.commandId)
  }
  const long = await host({ action: 'points', op: 'list', view: 'x'.repeat(500) })
  assert.ok(long.error.length < 120)
})

test('malformed cursors and non-string views are rejected for Agent callers', async () => {
  const tool = visionBenchTool('/tmp/unused-query-values')
  const cases = [
    [{ action: 'points', op: 'list', cursor: 42 }, 'cursor', 'INVALID_TYPE'],
    [{ action: 'timeline.list', cursor: 42 }, 'cursor', 'INVALID_TYPE'],
    [{ action: 'points', op: 'list', cursor: '   ' }, 'cursor', 'INVALID_VALUE'],
    [{ action: 'timeline.list', cursor: null }, 'cursor', 'INVALID_TYPE'],
    [{ action: 'points', op: 'list', view: [] }, 'view', 'INVALID_TYPE'],
    [{ action: 'points', op: 'list', view: null }, 'view', 'INVALID_TYPE'],
  ]
  for (const [args, field, reason] of cases) {
    for (const ran of [await tool.execute(args, exec), await host(args)]) {
      assert.equal(ran.ok, false, JSON.stringify(args))
      assert.equal(ran.errorCode, 'INVALID_FIELD')
      assert.equal(ran.details.field, field)
      assert.equal(ran.details.reason, reason)
      assert.equal('points' in ran, false)
      assert.equal('events' in ran, false)
    }
  }
})

test('non-Agent callers keep lenient view parsing', async () => {
  const ran = await executeVisionCommand({
    home: '/tmp/unused-query-values',
    cwd: '/tmp/proj',
    sessionId: 's1',
    source: 'user',
    action: 'points',
    payload: { action: 'points', op: 'list', view: null },
  })
  assert.notEqual(ran.errorCode, 'INVALID_FIELD')
})

test('postEvidence sends the page sessionId when given', async () => {
  /** @type {any[]} */
  const calls = []
  const post = async (/** @type {string} */ url, /** @type {any} */ body) => {
    calls.push([url, body])
    return { ok: true }
  }
  await postEvidence(post, '/proj', { kind: 'point', id: 'p1' }, () => {}, { sessionId: ' s-a ' })
  await postEvidence(post, '/proj', { kind: 'point', id: 'p1' }, () => {})
  assert.deepEqual(calls[0], ['/dsh-vision-bench/evidence', { cwd: '/proj', sessionId: 's-a', evidence: [{ kind: 'point', id: 'p1' }] }])
  assert.deepEqual(calls[1][1], { cwd: '/proj', evidence: [{ kind: 'point', id: 'p1' }] })
})
