// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_TEXT_CAPS, utf8ByteLength } from '../../src/application/commands/agent-result-caps.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import { saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

test('timeline pages of long Chinese summaries stay under the output cap without skips', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-tl-budget-' })
  const { home, cwd } = bench
  const summary = '警'.repeat(180)
  const timeline = Array.from({ length: 50 }, (_, i) => ({
    id: `e${String(i).padStart(2, '0')}`,
    at: 50 - i,
    kind: 'alarm',
    source: 'agent',
    sessionId: 'session-a',
    taskId: 'task',
    ok: true,
    summary,
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
    timeline,
  })

  /** @type {string[]} */
  const seen = []
  let cursor = ''
  for (let guard = 0; guard < 20; guard += 1) {
    const host = await runVisionBench(
      home,
      { action: 'timeline.list', limit: 50, ...(cursor ? { cursor } : {}) },
      cwd,
      { source: 'agent', sessionId: 'session-a' },
    )
    assert.equal(host.ok, true, host.error)
    const page = projectAgentResult({ action: 'timeline.list' }, host)
    assert.equal(page.ok, true, page.error)
    assert.equal(page.returned, page.events.length)
    assert.ok(page.events.length > 0)
    assert.ok(utf8ByteLength(page) <= AGENT_TEXT_CAPS.listBytes)
    seen.push(...page.events.map((/** @type {{ id: string }} */ e) => e.id))
    if (!page.nextCursor) break
    assert.equal(page.truncated, true)
    assert.equal(page.nextCursor, page.events[page.events.length - 1].id)
    cursor = page.nextCursor
  }
  assert.equal(seen.length, 50)
  assert.equal(new Set(seen).size, 50)
  assert.equal(seen[0], 'e00')
  assert.equal(seen[49], 'e49')

  const newer = {
    id: 'e-new',
    at: 99,
    kind: 'alarm',
    source: 'agent',
    sessionId: 'session-a',
    taskId: '',
    ok: true,
    summary: 'new',
  }
  saveWorkspace(home, cwd, { timeline: [newer, ...timeline] })
  const still = await runVisionBench(
    home,
    { action: 'timeline.list', limit: 50, cursor: seen[0] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(still.ok, true, still.error)
  assert.equal(still.events[0].id, seen[1])

  const expired = await runVisionBench(
    home,
    { action: 'timeline.list', cursor: 'dropped-anchor' },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(expired.errorCode, 'CURSOR_EXPIRED')
})

test('one oversized timeline event is RESULT_TOO_LARGE and is not consumed', () => {
  const page = projectAgentResult(
    { action: 'timeline.list' },
    {
      ok: true,
      action: 'timeline.list',
      commandId: 'cmd-tl',
      total: 1,
      returned: 1,
      nextCursor: null,
      truncated: false,
      events: [{ id: 'huge', at: 1, kind: 'alarm', source: 'agent', sessionId: 's', taskId: '', ok: true, summary: '警'.repeat(20_000) }],
    },
  )
  assert.equal(page.ok, false)
  assert.equal(page.errorCode, 'RESULT_TOO_LARGE')
  assert.equal(page.eventId, 'huge')
  assert.equal(page.nextCursor, null)
  assert.equal(page.returned, 0)
  assert.equal(page.retryable, false)
  assert.equal(page.commandId, 'cmd-tl')
  assert.match(page.error, /Vision UI/)
})
