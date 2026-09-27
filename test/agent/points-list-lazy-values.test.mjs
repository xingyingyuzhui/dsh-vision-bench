// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import {
  pointQuerySelectCount,
  resetPointQuerySelectCount,
} from '../../src/application/modbus/point-query-value.mjs'
import { comparePointRows } from '../../src/application/modbus/points-list-page.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

test('Agent points list resolves runtime values only for the selected page', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-list-lazy-' })
  const { home, cwd } = bench
  const points = Array.from({ length: 160 }, (_, i) => ({
    id: `p${String(i).padStart(3, '0')}`,
    name: `N${i}`,
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: i,
    type: 'uint16',
  }))
  const expected = [...points].sort(comparePointRows).map((p) => p.id)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 8,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      values: [{ pointId: 'p000', connectionId: 'c1', deviceId: 'd1', raw: 7, value: 7, ok: true, at: 1 }],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
          points,
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
  })

  /** @type {string[]} */
  const seen = []
  let cursor = ''
  for (const limit of [3, 20, 50]) {
    resetPointQuerySelectCount()
    const page = await runVisionBench(
      home,
      { action: 'points', op: 'list', limit, ...(cursor && limit === 3 ? { cursor } : {}) },
      cwd,
      { source: 'agent', sessionId: 'session-a' },
    )
    assert.equal(page.ok, true, page.error)
    assert.equal(page.returned, page.points.length)
    assert.equal(pointQuerySelectCount(), page.returned)
    assert.ok(page.returned <= limit)
    if (limit === 3 && !cursor) {
      assert.equal(page.points[0].id, expected[0])
      assert.equal(page.total, 160)
      cursor = page.nextCursor
      seen.push(...page.points.map((/** @type {{ id: string }} */ p) => p.id))
    }
  }

  cursor = ''
  const all = []
  for (let guard = 0; guard < 80; guard += 1) {
    const page = await runVisionBench(
      home,
      { action: 'points', op: 'list', limit: 3, ...(cursor ? { cursor } : {}) },
      cwd,
      { source: 'agent', sessionId: 'session-a' },
    )
    assert.equal(page.ok, true, page.error)
    all.push(...page.points.map((/** @type {{ id: string }} */ p) => p.id))
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  assert.deepEqual(all, expected)

  resetPointQuerySelectCount()
  const ui = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, {
    source: 'user',
    sessionId: 'session-a',
  })
  assert.equal(ui.ok, true, ui.error)
  assert.equal(ui.returned, 160)
  assert.equal(pointQuerySelectCount(), 160)
})
