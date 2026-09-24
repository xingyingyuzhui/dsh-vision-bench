// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace, loadWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { comparePointRows, pagePointsList } from '../../src/application/modbus/points-list-page.mjs'

test('pagePointsList: stable order and cursor continuity', () => {
  const points = [
    { id: 'b', connectionId: 'c2', deviceId: 'd1' },
    { id: 'a', connectionId: 'c1', deviceId: 'd1' },
    { id: 'c', connectionId: 'c1', deviceId: 'd2' },
  ]
  const p1 = pagePointsList({
    points,
    configVersion: 3,
    sessionId: 's1',
    connectionId: '',
    deviceId: '',
    view: 'full',
    limit: 2,
    cursor: '',
    isAgent: true,
  })
  assert.equal(p1.ok, true)
  assert.deepEqual(
    p1.points.map((p) => p.id),
    ['a', 'c'],
  )
  assert.ok(p1.nextCursor)
  const p2 = pagePointsList({
    points,
    configVersion: 3,
    sessionId: 's1',
    connectionId: '',
    deviceId: '',
    view: 'full',
    limit: 2,
    cursor: p1.nextCursor,
    isAgent: true,
  })
  assert.equal(p2.ok, true)
  assert.deepEqual(
    p2.points.map((p) => p.id),
    ['b'],
  )
  assert.equal(p2.nextCursor, null)
  const joined = [...p1.points, ...p2.points].sort(comparePointRows)
  assert.deepEqual(
    joined.map((p) => p.id),
    ['a', 'c', 'b'].sort((x, y) =>
      comparePointRows(
        points.find((p) => p.id === x),
        points.find((p) => p.id === y),
      ),
    ),
  )
})

test('Agent points list pages with summary view; claim untouched', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-list-page-' })
  const { home, cwd } = bench
  const points = Array.from({ length: 45 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    name: `N${i}`,
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: i,
    type: 'uint16',
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 7,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
          points,
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
  })
  const before = loadWorkspace(home, cwd).modbus.privateClaimSessionId
  const page1 = await runVisionBench(
    home,
    { action: 'points', op: 'list', view: 'summary', limit: 20 },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(page1.ok, true, page1.error)
  assert.equal(page1.view, 'summary')
  assert.equal(page1.total, 45)
  assert.equal(page1.returned, 20)
  assert.equal(page1.points.length, 20)
  assert.equal(page1.points[0].valueStatus != null, true)
  assert.equal('raw' in page1.points[0], false)
  assert.ok(page1.nextCursor)

  const page2 = await runVisionBench(
    home,
    { action: 'points', op: 'list', view: 'summary', limit: 20, cursor: page1.nextCursor },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(page2.ok, true, page2.error)
  assert.equal(page2.returned, 20)
  const page3 = await runVisionBench(
    home,
    { action: 'points', op: 'list', view: 'summary', limit: 20, cursor: page2.nextCursor },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(page3.ok, true, page3.error)
  assert.equal(page3.returned, 5)
  assert.equal(page3.nextCursor, null)
  const ids = [...page1.points, ...page2.points, ...page3.points].map((p) => p.id)
  assert.equal(ids.length, 45)
  assert.equal(new Set(ids).size, 45)
  assert.equal(loadWorkspace(home, cwd).modbus.privateClaimSessionId, before)
})
