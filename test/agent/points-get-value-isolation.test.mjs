// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import {
  assertHiddenValue,
  pt,
  runtimeFingerprint,
  seedDualPrivateSamePointId,
} from './points-value-isolation-helpers.mjs'

test('get/list: A does not receive B runtime value for same pointId', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-leak-' })
  const { home, cwd } = bench
  const before = runtimeFingerprint(seedDualPrivateSamePointId(home, cwd))
  const originA = { source: 'agent', sessionId: 'session-a' }

  const got = await runVisionBench(home, { action: 'points', op: 'get', ids: ['p'] }, cwd, originA)
  assert.equal(got.ok, true, got.error)
  assert.equal(got.returned, 1)
  assert.equal(got.points[0].id, 'p')
  assert.equal(got.points[0].connectionId, 'c1')
  assert.equal(got.points[0].deviceId, 'dc1')
  assertHiddenValue(got.points[0], { expectConn: 'c1', expectDev: 'dc1' })

  const listed = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, originA)
  assert.equal(listed.ok, true, listed.error)
  const row = listed.points.find((/** @type {any} */ p) => p.id === 'p')
  assert.ok(row)
  assertHiddenValue(row, { expectConn: 'c1', expectDev: 'dc1' })

  assert.deepEqual(runtimeFingerprint(loadWorkspace(home, cwd)), before)
})

test('get: reverse session/value order still hides foreign value', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-order-' })
  const { home, cwd } = bench
  seedDualPrivateSamePointId(home, cwd, {
    reverseSessions: true,
    values: [
      {
        key: 'p',
        pointId: 'p',
        connectionId: 'c1',
        deviceId: 'dc1',
        raw: 111,
        value: 111,
        ok: true,
        at: 99,
      },
      {
        key: 'p',
        pointId: 'p',
        connectionId: 'c2',
        deviceId: 'dc2',
        raw: 9876,
        value: 9876,
        ok: true,
        at: 1_700_000_000_000,
      },
    ],
  })
  // normalizeQualifiedValues collapses by pointId — after save/load only one survives.
  // Re-seed layered values after load by patching disk again with both (may collapse).
  // Assert B still cannot leak into A when the surviving record is B's.
  const ws = loadWorkspace(home, cwd)
  ws.modbus.values = [
    {
      key: 'p',
      pointId: 'p',
      connectionId: 'c2',
      deviceId: 'dc2',
      raw: 9876,
      value: 9876,
      ok: true,
      at: 1_700_000_000_000,
    },
  ]
  saveWorkspace(home, cwd, ws)

  const got = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p'] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(got.ok, true, got.error)
  assertHiddenValue(got.points[0], { expectConn: 'c1', expectDev: 'dc1' })
})

test('get: identical private triples still unavailable; sessionId cannot resolve slot', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-twin-' })
  const { home, cwd } = bench
  const twin = {
    connections: [connection('c1', 'tcp', '', { sim: true })],
    devices: [{ id: 'dc1', connectionId: 'c1', name: 'T', unitId: 1 }],
    points: [pt('p', 'c1', 'dc1', 0)],
    visualization: { schemaVersion: 2, components: [] },
  }
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      connections: [],
      devices: [],
      points: [],
      values: [
        {
          key: 'p',
          pointId: 'p',
          connectionId: 'c1',
          deviceId: 'dc1',
          raw: 42,
          value: 42,
          ok: true,
          at: 50,
        },
      ],
      share: { enabled: false, connections: false, points: false, visualization: false },
      privateClaimSessionId: 'session-a',
      sessionConfigs: { 'session-a': twin, 'session-b': structuredClone(twin) },
    },
  })
  const got = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p'] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(got.ok, true, got.error)
  assert.equal(got.points[0].valueStatus, 'unavailable')
  assert.equal(got.points[0].raw, null)
  assert.equal(got.points[0].value, null)
})

test('get: unique matching triple returns available; conn/dev mismatch hides', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-unique-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 3,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'dc1', connectionId: 'c1', name: 'D', unitId: 1 }],
      points: [pt('p', 'c1', 'dc1', 0)],
      values: [
        {
          key: 'p',
          pointId: 'p',
          connectionId: 'c1',
          deviceId: 'dc1',
          raw: 7,
          value: 7,
          ok: true,
          at: 12345,
        },
      ],
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const ok = await runVisionBench(home, { action: 'points', op: 'get', ids: ['p'] }, cwd, origin)
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.points[0].valueStatus, 'available')
  assert.equal(ok.points[0].raw, 7)
  assert.equal(ok.points[0].at, 12345)

  const ws = loadWorkspace(home, cwd)
  ws.modbus.values = [
    {
      key: 'p',
      pointId: 'p',
      connectionId: 'c9',
      deviceId: 'dc1',
      raw: 7,
      value: 7,
      ok: true,
      at: 12345,
    },
  ]
  saveWorkspace(home, cwd, ws)
  const badConn = await runVisionBench(home, { action: 'points', op: 'get', ids: ['p'] }, cwd, origin)
  assert.equal(badConn.points[0].valueStatus, 'unavailable')
  assert.equal(badConn.points[0].raw, null)

  ws.modbus.values = [
    {
      key: 'p',
      pointId: 'p',
      connectionId: 'c1',
      deviceId: 'dx',
      raw: 7,
      value: 7,
      ok: true,
      at: 12345,
    },
  ]
  saveWorkspace(home, cwd, ws)
  const badDev = await runVisionBench(home, { action: 'points', op: 'get', ids: ['p'] }, cwd, origin)
  assert.equal(badDev.points[0].valueStatus, 'unavailable')
  assert.equal(badDev.points[0].raw, null)
})
