// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { visionBenchTool } from '../../src/interfaces/agent/vision-bench-tool.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { createBench, connection, pointSeries } from '../helpers/workspace-factory.mjs'

/**
 * @param {any} t
 * @param {string} home
 */
function withRealHost(t, home) {
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
}

/**
 * @param {string} cwd
 * @param {string} [sessionId]
 */
function agentOf(cwd, sessionId = 'session-a') {
  return { session: { header: { cwd, id: sessionId } } }
}

/**
 * @param {any} ws
 */
function claimFingerprint(ws) {
  const mb = ws?.modbus || {}
  return {
    configVersion: mb.configVersion || 1,
    privateClaimSessionId: mb.privateClaimSessionId || '',
    sessionConfigKeys: Object.keys(mb.sessionConfigs || {}).sort(),
    flatPointCount: Array.isArray(mb.points) ? mb.points.length : 0,
  }
}

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
  const before = claimFingerprint(loadWorkspace(home, cwd))
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
  assert.deepEqual(claimFingerprint(loadWorkspace(home, cwd)), before)
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

test('points get: cross-session private points look like missing; shared points visible', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-get-scope-' })
  const { home, cwd } = bench
  const pt = (id, connectionId, deviceId, address) => ({
    id,
    connectionId,
    deviceId,
    name: id,
    area: 'holdingRegister',
    function: 3,
    address,
  })
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

  // Shared points: enable points share and put the point on the shared layer.
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
  const before = claimFingerprint(loadWorkspace(home, cwd))
  const legacy = await runVisionBench(
    home,
    { action: 'points', op: 'get', ids: ['p0'], expectedConfigVersion: 1 },
    cwd,
    { source: 'agent', sessionId: 'opener' },
  )
  assert.equal(legacy.ok, true, legacy.error)
  assert.equal(legacy.configVersion, 6)
  const afterLegacy = claimFingerprint(loadWorkspace(home, cwd))
  assert.deepEqual(afterLegacy, before, 'get must not persist claim')

  // Partition via status (which claims), then anonymous get must fail.
  await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent', sessionId: 'opener' })
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
