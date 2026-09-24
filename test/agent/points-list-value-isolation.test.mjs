// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../src/interfaces/agent/vision-bench-tool.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench, pointSeries } from '../helpers/workspace-factory.mjs'
import { pt, seedDualPrivateSamePointId } from './points-value-isolation-helpers.mjs'

test('shared points: matching value available; shadowed private does not fake ambiguity', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-share-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 5,
      share: { enabled: true, connections: true, points: true, visualization: false },
      privateClaimSessionId: 'session-a',
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'dc1', connectionId: 'c1', name: 'Shared', unitId: 1 }],
      points: [pt('shared-p', 'c1', 'dc1', 1)],
      values: [
        {
          key: 'shared-p',
          pointId: 'shared-p',
          connectionId: 'c1',
          deviceId: 'dc1',
          raw: 55,
          value: 55,
          ok: true,
          at: 88,
        },
      ],
      sessionConfigs: {
        'session-a': {
          connections: [],
          devices: [],
          points: [pt('shared-p', 'c1', 'dc1', 9)],
          visualization: { schemaVersion: 2, components: [] },
        },
        'session-b': {
          connections: [],
          devices: [],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
  })
  const b = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['shared-p'] },
    cwd,
    { source: 'agent', sessionId: 'session-b' },
  )
  assert.equal(b.ok, true, b.error)
  assert.equal(b.points[0].valueStatus, 'available')
  assert.equal(b.points[0].raw, 55)
  assert.equal(b.points[0].address, 1)
})

test('legacy record without provenance + dual private stays unavailable after save/load', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-legacy-' })
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
      // Missing connectionId/deviceId — normalizeQualifiedValues may backfill.
      values: [{ key: 'p', pointId: 'p', raw: 9, value: 9, ok: true, at: 3 }],
      share: { enabled: false, connections: false, points: false, visualization: false },
      privateClaimSessionId: 'session-a',
      sessionConfigs: { 'session-a': twin, 'session-b': structuredClone(twin) },
    },
  })
  // Force a real load/normalize cycle.
  const reloaded = loadWorkspace(home, cwd)
  saveWorkspace(home, cwd, reloaded)
  const got = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p'] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(got.ok, true, got.error)
  assert.equal(got.points[0].valueStatus, 'unavailable')
  assert.equal(got.points[0].raw, null)
})

test('mixed get: safe / missing-value / unavailable / absent keep counters', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-mix-' })
  const { home, cwd } = bench
  seedDualPrivateSamePointId(home, cwd)
  const ws = loadWorkspace(home, cwd)
  ws.modbus.sessionConfigs['session-a'].points.push(pt('safe', 'c1', 'dc1', 2))
  ws.modbus.sessionConfigs['session-a'].points.push(pt('empty', 'c1', 'dc1', 3))
  ws.modbus.values = [
    ...(ws.modbus.values || []),
    {
      key: 'safe',
      pointId: 'safe',
      connectionId: 'c1',
      deviceId: 'dc1',
      raw: 1,
      value: 1,
      ok: true,
      at: 10,
    },
  ]
  saveWorkspace(home, cwd, ws)

  const got = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['safe', 'empty', 'p', 'ghost'] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(got.ok, true, got.error)
  assert.equal(got.partial, true)
  assert.equal(got.requested, 4)
  assert.equal(got.returned, 3)
  assert.deepEqual(got.missingIds, ['ghost'])
  const byId = Object.fromEntries(got.points.map((/** @type {any} */ r) => [r.id, r]))
  assert.equal(byId.safe.valueStatus, 'available')
  assert.equal(byId.safe.raw, 1)
  assert.equal(byId.empty.valueStatus, 'missing')
  assert.equal(byId.empty.raw, null)
  assert.equal(byId.p.valueStatus, 'unavailable')
  assert.equal(byId.p.raw, null)
})

test('Agent tool get/list projection keeps valueStatus and hides foreign raw', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-tool-' })
  const { home, cwd } = bench
  seedDualPrivateSamePointId(home, cwd)
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
  const agent = { session: { header: { cwd, id: 'session-a' } } }
  const get = await tool.execute(
    { action: 'points', op: 'get', ids: ['p'], commandId: 'cmd-iso-get' },
    { agent },
  )
  assert.equal(get.ok, true, get.error)
  assert.equal(get.commandId, 'cmd-iso-get')
  assert.equal(get.points[0].valueStatus, 'unavailable')
  assert.equal(get.points[0].raw, null)
  assert.equal('owners' in get.points[0], false)

  const list = await tool.execute(
    { action: 'points', op: 'list', commandId: 'cmd-iso-list' },
    { agent },
  )
  assert.equal(list.ok, true, list.error)
  assert.equal(list.commandId, 'cmd-iso-list')
  const row = list.points.find((/** @type {any} */ p) => p.id === 'p')
  assert.ok(row)
  assert.equal(row.valueStatus, 'unavailable')
  assert.equal(row.raw, null)
})

test('list still returns valueStatus on ordinary single-session workspace', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-val-iso-list-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }).map((p) => ({ ...p, id: 'p0' })),
      values: [],
    },
  })
  const listed = await runVisionBench(
    home,
    { action: 'points', op: 'list' },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(listed.ok, true, listed.error)
  assert.equal(listed.points[0].valueStatus, 'missing')
})
