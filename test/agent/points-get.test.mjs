// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { createBench, connection, pointSeries } from '../helpers/workspace-factory.mjs'
import { fingerprintOnDisk } from './points-get-helpers.mjs'

test('points get: batch ids success keeps order/dedupe and does not claim or mutate', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-ok-' })
  const { home, cwd } = bench
  const conn = connection('c1', 'tcp', '', { sim: true })
  const points = pointSeries('hr', 4, { connectionId: 'c1', deviceId: 'd1' }).map((p, i) => ({
    ...p,
    id: `p${i}`,
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 5,
      connections: [conn],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points,
      values: [{ key: 'p1', pointId: 'p1', raw: 11, value: 11, ok: true, at: Date.now() }],
    },
  })
  const before = fingerprintOnDisk(home, cwd)
  let transportCalls = 0
  const transport = {
    read() {
      transportCalls += 1
      throw new Error('transport must not run for points get')
    },
    write() {
      transportCalls += 1
      throw new Error('transport must not run for points get')
    },
  }
  const origin = { source: 'agent', sessionId: 'session-a' }
  const ran = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p1', 'p0', 'p1', 'p3'] },
    cwd,
    origin,
    { transport },
  )
  assert.equal(ran.ok, true, ran.error)
  assert.equal(ran.partial, false)
  assert.equal(ran.requested, 3)
  assert.equal(ran.returned, 3)
  assert.deepEqual(ran.missingIds, [])
  assert.deepEqual(
    ran.points.map((/** @type {any} */ p) => p.id),
    ['p1', 'p0', 'p3'],
  )
  assert.equal(ran.configVersion, 5)
  assert.equal(ran.points[0].value, 11)
  assert.equal('workspace' in ran, false)
  assert.equal(transportCalls, 0)
  assert.deepEqual(fingerprintOnDisk(home, cwd), before)
})

test('points get: pointId/id aliases; conflicting selectors → FIELD_CONFLICT', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-alias-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 2, { connectionId: 'c1', deviceId: 'd1' }).map((p, i) => ({
        ...p,
        id: `p${i}`,
      })),
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const byPointId = await runVisionBench(home, { action: 'points', op: 'get', pointId: 'p0' }, cwd, origin)
  assert.equal(byPointId.ok, true, byPointId.error)
  assert.deepEqual(
    byPointId.points.map((/** @type {any} */ p) => p.id),
    ['p0'],
  )
  const byId = await runVisionBench(home, { action: 'points', op: 'get', id: 'p1' }, cwd, origin)
  assert.equal(byId.ok, true, byId.error)
  assert.deepEqual(
    byId.points.map((/** @type {any} */ p) => p.id),
    ['p1'],
  )
  const same = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p0'], pointId: 'p0', id: 'p0' },
    cwd,
    origin,
  )
  assert.equal(same.ok, true, same.error)
  assert.equal(same.returned, 1)
  const conflict = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p0'], pointId: 'p1' },
    cwd,
    origin,
  )
  assert.equal(conflict.ok, false)
  assert.equal(conflict.errorCode, ERROR_CODES.FIELD_CONFLICT)
})

test('points get: empty / bad / oversize selectors fail without list fallback or version lock', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-bad-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 9,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }).map((p) => ({ ...p, id: 'p0' })),
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const empty = await runVisionBench(home, { action: 'points', op: 'get' }, cwd, origin)
  assert.equal(empty.ok, false)
  assert.equal(empty.errorCode, ERROR_CODES.TARGET_REQUIRED)
  assert.ok(Array.isArray(empty.missingFields))
  assert.ok(empty.missingFields.includes('ids') || empty.missingFields.includes('pointId'))
  assert.notEqual(empty.errorCode, ERROR_CODES.CONFIG_VERSION_REQUIRED)

  const blank = await runVisionBench(home, { action: 'points', op: 'get', ids: ['', '  '] }, cwd, origin)
  assert.equal(blank.ok, false)
  assert.equal(blank.errorCode, ERROR_CODES.TARGET_REQUIRED)

  const badType = await runVisionBench(home, { action: 'points', op: 'get', ids: [1, 'p0'] }, cwd, origin)
  assert.equal(badType.ok, false)
  assert.ok(['INVALID_FIELD', 'TARGET_REQUIRED'].includes(String(badType.errorCode)))

  const ids33 = Array.from({ length: 33 }, (_, i) => `x${i}`)
  const over = await runVisionBench(home, { action: 'points', op: 'get', ids: ids33 }, cwd, origin)
  assert.equal(over.ok, false)
  assert.ok(['INVALID_FIELD', 'TARGET_REQUIRED'].includes(String(over.errorCode)))
  assert.notEqual(over.errorCode, ERROR_CODES.CONFIG_VERSION_REQUIRED)
  assert.ok(!Array.isArray(over.points) || over.points.length === 0)
})

test('points get: partial and total missing', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-miss-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 3,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 2, { connectionId: 'c1', deviceId: 'd1' }).map((p, i) => ({
        ...p,
        id: `p${i}`,
      })),
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const partial = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p0', 'missing', 'p1'] },
    cwd,
    origin,
  )
  assert.equal(partial.ok, true, partial.error)
  assert.equal(partial.partial, true)
  assert.equal(partial.requested, 3)
  assert.equal(partial.returned, 2)
  assert.deepEqual(partial.missingIds, ['missing'])
  assert.deepEqual(
    partial.points.map((/** @type {any} */ p) => p.id),
    ['p0', 'p1'],
  )

  const none = await runVisionBench(home, { action: 'points', op: 'get', ids: ['nope', 'gone'] }, cwd, origin)
  assert.equal(none.ok, false)
  assert.equal(none.errorCode, ERROR_CODES.POINT_NOT_FOUND)
  assert.equal(none.partial, undefined)
  assert.equal(none.returned, 0)
  assert.deepEqual(none.points, [])
  assert.deepEqual(none.missingIds, ['nope', 'gone'])
})

test('points get: optional connection/device filter; wrong filter → missing not other conn leak', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-filter-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      connections: [
        connection('c1', 'tcp', '', { sim: true }),
        connection('c2', 'tcp', '', { sim: true }),
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [
        ...pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }).map((p) => ({ ...p, id: 'p-c1' })),
        ...pointSeries('hr', 1, { connectionId: 'c2', deviceId: 'd2' }).map((p) => ({ ...p, id: 'p-c2' })),
      ],
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const ok = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p-c1'], connectionId: 'c1', deviceId: 'd1' },
    cwd,
    origin,
  )
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.points[0].id, 'p-c1')

  const filteredOut = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p-c2'], connectionId: 'c1' },
    cwd,
    origin,
  )
  assert.equal(filteredOut.ok, false)
  assert.equal(filteredOut.errorCode, ERROR_CODES.POINT_NOT_FOUND)
  assert.deepEqual(filteredOut.points, [])
  assert.deepEqual(filteredOut.missingIds, ['p-c2'])
})
