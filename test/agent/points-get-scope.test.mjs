// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { visionBenchTool } from '../../src/interfaces/agent/vision-bench-tool.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { createBench, connection, pointSeries } from '../helpers/workspace-factory.mjs'
import { ensureWorkspaceClaimed } from '../../src/application/modbus/workspace-session-view.mjs'
import { agentOf, fingerprintOnDisk, pt, withRealHost } from './points-get-helpers.mjs'

test('points get: cross-session private points look like missing; shared points visible', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-scope-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 4,
      connections: [],
      devices: [],
      points: [],
      share: { enabled: false, connections: false, points: false, visualization: false },
      privateClaimSessionId: 'session-a',
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
          points: [pt('priv-a', 'c1', 'd1', 0)],
          visualization: { schemaVersion: 2, components: [] },
        },
        'session-b': {
          connections: [connection('c2', 'tcp', '', { sim: true })],
          devices: [{ id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }],
          points: [pt('priv-b', 'c2', 'd2', 0)],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
  })

  const aSeesB = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['priv-b'] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  const aSeesMissing = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['does-not-exist'] },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(aSeesB.ok, false)
  assert.equal(aSeesMissing.ok, false)
  assert.equal(aSeesB.errorCode, aSeesMissing.errorCode)
  assert.deepEqual(aSeesB.missingIds, ['priv-b'])
  assert.deepEqual(aSeesMissing.missingIds, ['does-not-exist'])

  const sharedWs = loadWorkspace(home, cwd)
  sharedWs.modbus.share = { enabled: true, connections: true, points: true, visualization: false }
  sharedWs.modbus.connections = [connection('c1', 'tcp', '', { sim: true })]
  sharedWs.modbus.devices = [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }]
  sharedWs.modbus.points = [pt('shared-p', 'c1', 'd1', 1)]
  saveWorkspace(home, cwd, sharedWs)

  const bSeesShared = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['shared-p'] },
    cwd,
    { source: 'agent', sessionId: 'session-b' },
  )
  assert.equal(bSeesShared.ok, true, bSeesShared.error)
  assert.equal(bSeesShared.returned, 1)
  assert.equal(bSeesShared.points[0].id, 'shared-p')
})

test('points get: unpartitioned does not persist claim; partitioned without session rejects; version ignored', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-claim-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 6,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }).map((p) => ({ ...p, id: 'p0' })),
    },
  })
  const before = fingerprintOnDisk(home, cwd)
  const legacy = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p0'], expectedConfigVersion: 1 },
    cwd,
    { source: 'agent', sessionId: 'opener' },
  )
  assert.equal(legacy.ok, true, legacy.error)
  assert.equal(legacy.configVersion, 6)
  assert.deepEqual(fingerprintOnDisk(home, cwd), before, 'get must not persist claim')

  await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent', sessionId: 'opener' })
  assert.deepEqual(fingerprintOnDisk(home, cwd), before, 'status must not persist claim either')

  await ensureWorkspaceClaimed(home, cwd, 'opener')
  const anon = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p0'] },
    cwd,
    { source: 'agent' },
  )
  assert.equal(anon.ok, false)
  assert.equal(anon.errorCode, ERROR_CODES.SESSION_REQUIRED)
})

test('points typo and config points.get → UNKNOWN_OP, not CONFIG_VERSION_REQUIRED', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-unknown-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const typo = await runVisionBench(home, { action: 'points', op: 'typo' }, cwd, origin)
  assert.equal(typo.ok, false)
  assert.equal(typo.errorCode, 'UNKNOWN_OP')
  assert.notEqual(typo.errorCode, ERROR_CODES.CONFIG_VERSION_REQUIRED)
  assert.match(String(typo.error || typo.hint || ''), /list|get|add|update|remove|clear/i)

  const viaConfig = await runVisionBench(
    home,
    { action: 'config', operation: 'points.get', target: { pointId: 'p0' }, value: {} },
    cwd,
    origin,
  )
  assert.equal(viaConfig.ok, false)
  assert.equal(viaConfig.errorCode, 'UNKNOWN_OP')
  assert.notEqual(viaConfig.errorCode, ERROR_CODES.CONFIG_VERSION_REQUIRED)
  assert.match(String(viaConfig.error || viaConfig.hint || ''), /points.*op=get|op=get/i)
})

test('points list and mutation ops still require version / keep FIELD_CONFLICT guards', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-regress-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 8,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }).map((p) => ({ ...p, id: 'p0' })),
    },
  })
  const origin = { source: 'agent', sessionId: 's1' }
  const listed = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, origin)
  assert.equal(listed.ok, true, listed.error)
  assert.ok(listed.points.length >= 1)

  const noVer = await runVisionBench(
    home,
    {
      action: 'points',
      op: 'update',
      point: { id: 'p0', name: 'X', monitorEnabled: true, trendEnabled: false },
    },
    cwd,
    origin,
  )
  assert.equal(noVer.ok, false)
  assert.equal(noVer.errorCode, ERROR_CODES.CONFIG_VERSION_REQUIRED)

  const conflict = await runVisionBench(
    home,
    {
      action: 'points',
      op: 'update',
      expectedConfigVersion: 8,
      point: { id: 'p0', monitorEnabled: true, trendEnabled: false },
    },
    cwd,
    origin,
  )
  assert.equal(conflict.ok, false)
  assert.equal(conflict.errorCode, ERROR_CODES.FIELD_CONFLICT)
})

test('Agent tool execute → Host → projection keeps commandId for get success and failure', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-tool-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 3,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }).map((p) => ({ ...p, id: 'p0' })),
    },
  })
  withRealHost(t, home)
  const tool = visionBenchTool(home)
  const ok = await tool.execute(
    { action: 'points', op: 'get', ids: ['p0'], commandId: 'cmd-get-ok' },
    { agent: agentOf(cwd) },
  )
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.commandId, 'cmd-get-ok')
  assert.equal(ok.returned, 1)
  assert.equal('workspace' in ok, false)

  const miss = await tool.execute(
    { action: 'points', op: 'get', ids: ['nope'], commandId: 'cmd-get-miss' },
    { agent: agentOf(cwd) },
  )
  assert.equal(miss.ok, false)
  assert.equal(miss.errorCode, ERROR_CODES.POINT_NOT_FOUND)
  assert.equal(miss.commandId, 'cmd-get-miss')
})
