// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterAlarmStateForSession,
  filterTasksForSession,
  pointRuntimeVisible,
  projectVisiblePolling,
  redactAgentStatusLog,
  scopeTrendSeriesForSession,
} from '../../src/application/modbus/agent-runtime-visibility.mjs'
import { isUniquelyOwnedConnection } from '../../src/application/modbus/poll-session-ownership.mjs'
import { saveWorkspace, loadWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

/**
 * @param {string} sid
 * @param {string} cid
 * @param {string} pid
 */
function privateSlice(sid, cid, pid) {
  return {
    connections: [connection(cid, 'tcp', '', { sim: true, name: `${sid}-${cid}` })],
    devices: [{ id: `d-${cid}`, connectionId: cid, name: sid, unitId: 1 }],
    points: [
      {
        id: pid,
        name: `${sid}-${pid}`,
        connectionId: cid,
        deviceId: `d-${cid}`,
        function: 3,
        address: 1,
        type: 'uint16',
        monitorEnabled: true,
        alarmEnabled: true,
      },
    ],
    visualization: { schemaVersion: 2, components: [] },
  }
}

test('unique connection ownership: dual private same id is not unique', () => {
  const modbus = {
    connections: [],
    share: { enabled: false, connections: false, points: false },
    sessionConfigs: {
      'session-a': { connections: [{ id: 'c-same' }] },
      'session-b': { connections: [{ id: 'c-same' }] },
    },
  }
  assert.equal(isUniquelyOwnedConnection(modbus, 'c-same'), false)
})

test('projectVisiblePolling drops other-session and ambiguous slots', () => {
  const layered = {
    connections: [],
    share: { enabled: false, connections: false, points: false },
    sessionConfigs: {
      'session-a': { connections: [{ id: 'c-a' }, { id: 'c-amb' }] },
      'session-b': { connections: [{ id: 'c-b' }, { id: 'c-amb' }] },
    },
  }
  const polling = {
    'c-a': { enabled: true, intervalMs: 1000 },
    'c-b': { enabled: true, intervalMs: 2000 },
    'c-amb': { enabled: true, intervalMs: 3000 },
  }
  const visible = projectVisiblePolling(layered, 'session-a', [{ id: 'c-a' }, { id: 'c-amb' }], polling)
  assert.deepEqual(Object.keys(visible).sort(), ['c-a'])
  assert.equal(visible['c-a'].intervalMs, 1000)
})

test('filterAlarmStateForSession hides foreign and ambiguous process alarms', () => {
  const a = privateSlice('session-a', 'c-a', 'p-a')
  const b = privateSlice('session-b', 'c-b', 'p-b')
  const twin = privateSlice('session-a', 'c-twin', 'p-shared')
  const twinB = privateSlice('session-b', 'c-twin-b', 'p-shared')
  const layered = {
    connections: [],
    points: [],
    share: { enabled: false, connections: false, points: false },
    sessionConfigs: {
      'session-a': { ...a, points: [...a.points, ...twin.points], connections: [...a.connections, ...twin.connections] },
      'session-b': {
        ...b,
        points: [...b.points, ...twinB.points],
        connections: [...b.connections, ...twinB.connections],
      },
    },
    alarmState: {
      'p-a': { group: 'process', pointId: 'p-a', status: 'active', connectionId: 'c-a' },
      'p-b': { group: 'process', pointId: 'p-b', status: 'active', connectionId: 'c-b' },
      'p-shared': { group: 'process', pointId: 'p-shared', status: 'active', connectionId: 'c-twin' },
      'comm:c-b': { group: 'comm', connectionId: 'c-b', status: 'active' },
      'comm:c-a': { group: 'comm', connectionId: 'c-a', status: 'active' },
    },
  }
  const packA = {
    connections: layered.sessionConfigs['session-a'].connections,
    points: layered.sessionConfigs['session-a'].points,
  }
  const filtered = filterAlarmStateForSession(layered, 'session-a', packA, layered.alarmState)
  assert.deepEqual(Object.keys(filtered).sort(), ['comm:c-a', 'p-a'])
  assert.equal(pointRuntimeVisible(layered, 'session-a', 'p-shared').visible, false)
})

test('filterTasksForSession and redactAgentStatusLog', () => {
  const tasks = [
    { id: '1', sessionId: 'session-a', summary: 'a' },
    { id: '2', sessionId: 'session-b', summary: 'b' },
    { id: '3', sessionId: '', summary: 'orphan' },
  ]
  assert.deepEqual(
    filterTasksForSession(tasks, 'session-a').map((t) => t.id),
    ['1'],
  )
  const redacted = redactAgentStatusLog([{ action: 'build', summary: 'secret', at: 1, ok: true }])
  assert.deepEqual(redacted.log, [])
  assert.equal(redacted.logHiddenCount, 1)
})

test('scopeTrendSeriesForSession blanks ambiguous / foreign samples', () => {
  const layered = {
    connections: [],
    points: [],
    share: { enabled: false, connections: false, points: false },
    sessionConfigs: {
      'session-a': privateSlice('session-a', 'c-a', 'p-a'),
      'session-b': {
        ...privateSlice('session-b', 'c-b', 'p-b'),
        points: [
          ...privateSlice('session-b', 'c-b', 'p-b').points,
          {
            id: 'p-a',
            name: 'B-owned-same-id',
            connectionId: 'c-b',
            deviceId: 'd-c-b',
            function: 3,
            address: 9,
            type: 'uint16',
            monitorEnabled: true,
          },
        ],
      },
    },
  }
  const series = [
    {
      pointId: 'p-a',
      name: 'leaked',
      connectionId: 'c-b',
      samples: [[1, 2]],
      count: 99,
      returned: 1,
    },
  ]
  const packPoints = layered.sessionConfigs['session-a'].points
  const scoped = scopeTrendSeriesForSession(layered, 'session-a', series, packPoints)
  assert.equal(scoped[0].dataStatus, 'unavailable')
  assert.equal(scoped[0].count, 0)
  assert.deepEqual(scoped[0].samples, [])
  assert.equal(scoped[0].name, '')
})

test('Agent status/alarm/trend: A cannot see B private runtime; disk unchanged', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-runtime-vis-' })
  const { home, cwd } = bench
  const sliceA = privateSlice('session-a', 'c-a', 'p-a')
  const sliceB = privateSlice('session-b', 'c-b', 'p-b')
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 4,
      share: { enabled: false, connections: false, points: false, visualization: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      pollingByConnection: {
        'c-a': { enabled: true, intervalMs: 111 },
        'c-b': { enabled: true, intervalMs: 222 },
      },
      alarmState: {
        'p-a': { group: 'process', pointId: 'p-a', status: 'active', condition: 'active', connectionId: 'c-a' },
        'p-b': { group: 'process', pointId: 'p-b', status: 'active', condition: 'active', connectionId: 'c-b' },
        'comm:c-b': { group: 'comm', connectionId: 'c-b', status: 'active', condition: 'active' },
      },
      trend: {
        'p-a': [
          [10, 1],
          [20, 2],
        ],
        'p-b': [
          [10, 9],
          [20, 8],
        ],
      },
      sessionConfigs: {
        'session-a': sliceA,
        'session-b': sliceB,
      },
    },
    tasks: [
      { id: 'ta', sessionId: 'session-a', type: 'read', status: 'ok', summary: 'A task' },
      { id: 'tb', sessionId: 'session-b', type: 'read', status: 'ok', summary: 'B secret' },
    ],
    log: [{ at: 1, ok: true, action: 'build', summary: 'should hide from agent' }],
  })
  const originA = { source: 'agent', sessionId: 'session-a' }

  const statusHost = await runVisionBench(home, { action: 'status' }, cwd, originA)
  assert.equal(statusHost.ok, true, statusHost.error)
  assert.deepEqual(Object.keys(statusHost.modbus.pollingByConnection || {}).sort(), ['c-a'])
  assert.equal((statusHost.tasks || []).some((/** @type {any} */ x) => x.id === 'tb'), false)
  assert.deepEqual(statusHost.log || [], [])
  assert.ok((statusHost.logHiddenCount || 0) >= 1)

  const dispatch = createVisionCommandDispatcher(home)
  unregisterVisionHost()
  const stop = registerVisionHost(dispatch)
  t.after(() => {
    stop()
    unregisterVisionHost()
  })

  const tool = visionBenchTool(home)
  const agent = { session: { header: { cwd, id: 'session-a' } } }
  const status = await tool.execute({ action: 'status' }, { agent })
  assert.equal(status.ok, true, status.error)
  assert.deepEqual(Object.keys(status.modbus.pollingByConnection || {}).sort(), ['c-a'])
  assert.equal(status.modbus.counts.connections, 1)
  assert.equal(status.modbus.counts.alarmsActive, 1)
  assert.equal((status.tasks || []).some((/** @type {any} */ x) => x.id === 'tb'), false)
  assert.deepEqual(status.log || [], [])

  const alarm = await tool.execute({ action: 'alarm', connectionId: 'c-a' }, { agent })
  assert.equal(alarm.ok, true, alarm.error)
  assert.deepEqual(Object.keys(alarm.alarms || {}).sort(), ['p-a'])

  const foreign = await tool.execute({ action: 'alarm', alarmId: 'p-b', connectionId: 'c-a' }, { agent })
  assert.equal(foreign.ok, false)

  const alarmHost = await runVisionBench(home, { action: 'alarm' }, cwd, originA)
  assert.equal(alarmHost.ok, true, alarmHost.error)
  assert.deepEqual(Object.keys(alarmHost.alarms || {}).sort(), ['p-a'])

  const trend = await tool.execute(
    { action: 'trend', pointIds: ['p-a', 'p-b'], connectionId: 'c-a', limit: 5, start: 0, end: 1_000_000 },
    { agent },
  )
  assert.equal(trend.ok, true, trend.error)
  const byId = Object.fromEntries((trend.trend?.series || []).map((/** @type {any} */ s) => [s.pointId, s]))
  assert.ok((byId['p-a']?.samples || []).length >= 1)
  assert.equal(byId['p-b']?.dataStatus, 'unavailable')
  assert.deepEqual(byId['p-b']?.samples || [], [])

  const after = loadWorkspace(home, cwd)
  assert.equal(after.modbus.privateClaimSessionId, 'session-a')
  assert.deepEqual(Object.keys(after.modbus.sessionConfigs || {}).sort(), ['session-a', 'session-b'])
  assert.equal(after.modbus.sessionConfigs['session-b'].points[0].id, 'p-b')
  // Runtime maps must remain globally intact (Agent filter is projection-only).
  assert.ok(after.modbus.pollingByConnection['c-b'])
  assert.ok(after.modbus.alarmState['p-b'])
  assert.ok(after.modbus.trend['p-b'])
})
