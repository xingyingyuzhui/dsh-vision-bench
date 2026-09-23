import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_TEXT_CAPS,
  projectAgentResult,
  utf8ByteLength,
} from '../../src/application/commands/agent-result-projection.mjs'

test('projectAgentResult: status/read/config drop bulky layers under Agent text caps', () => {
  const points = Array.from({ length: 16 }, (_, i) => ({
    id: `p${i}`,
    connectionId: `c${i % 8}`,
    deviceId: 'd1',
    name: `P${i}`,
    raw: i,
    value: i,
  }))
  const connections = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    name: `C${i}`,
    conn: { mode: 'tcp', sim: true },
  }))
  const frames = Array.from({ length: 500 }, (_, i) => ({
    id: `f${i}`,
    frameId: `f${i}`,
    transactionId: `tx${i}`,
    requestHex: 'a'.repeat(64),
    responseHex: 'b'.repeat(64),
  }))
  const framesByConnection = Object.fromEntries(connections.map((c) => [c.id, frames]))
  const statusRaw = {
    ok: true,
    action: 'status',
    commandId: 'cmd-status',
    configVersion: 9,
    keil: { project: '/tmp/a.uvprojx', target: 'Target 1' },
    modbus: {
      configVersion: 9,
      connections,
      devices: [{ id: 'd1', connectionId: 'c0', name: 'D1', unitId: 1 }],
      points,
      values: points.map((p) => ({ pointId: p.id, key: p.id, raw: 1, value: 1 })),
      framesByConnection,
      alarmState: Object.fromEntries(points.map((p) => [p.id, { condition: 'normal', pointId: p.id }])),
      conn: { mode: 'tcp', sim: true },
    },
    tasks: [{ id: 't1', type: 'read', status: 'ok', summary: 'ok' }],
    running: [],
    timeline: Array.from({ length: 100 }, (_, i) => ({ kind: 'x', summary: `e${i}` })),
  }
  const status = projectAgentResult({ action: 'status' }, statusRaw)
  assert.equal(status.ok, true)
  assert.equal(status.commandId, 'cmd-status')
  assert.equal(status.configVersion, 9)
  assert.equal(status.modbus.counts.points, 16)
  assert.equal(status.modbus.counts.connections, 8)
  assert.equal('framesByConnection' in status.modbus, false)
  assert.equal('values' in status.modbus, false)
  assert.equal('alarmState' in status.modbus, false)
  assert.equal('points' in status.modbus, false)
  assert.ok(utf8ByteLength(status) <= AGENT_TEXT_CAPS.statusBytes, 'status ≤16KiB')

  const readRaw = {
    ok: true,
    action: 'read',
    taskId: 't-read',
    simulated: true,
    results: [{ ok: true, connectionId: 'c0', deviceId: 'd1' }],
    values: points.map((p) => ({ pointId: p.id, key: p.id, raw: p.raw, value: p.value })),
    framesLog: frames.slice(0, 3).map((f) => ({ ...f, payload: 'x'.repeat(200) })),
    framesByConnection,
  }
  const read = projectAgentResult({ action: 'read', pointId: 'p3' }, readRaw)
  assert.equal(read.ok, true)
  assert.equal('framesByConnection' in read, false)
  assert.deepEqual(
    read.values.map((/** @type {any} */ v) => v.pointId),
    ['p3'],
  )
  assert.ok(read.framesLog.every((/** @type {any} */ f) => f.frameId && 'transactionId' in f))
  assert.ok(!read.framesLog.some((/** @type {any} */ f) => f.requestHex), 'frame bodies stripped')
  assert.ok(utf8ByteLength(read) <= AGENT_TEXT_CAPS.singlePointReadBytes, 'single-point read ≤8KiB')

  const configRaw = {
    ok: true,
    action: 'points',
    previousConfigVersion: 1,
    nextConfigVersion: 2,
    changedIds: ['pA', 'pB', 'pC'],
    changedPointIds: ['pA', 'pB', 'pC'],
    postCommitWarnings: [],
    points,
    connections,
    devices: [{ id: 'd1' }],
    workspace: { log: [] },
  }
  const config = projectAgentResult({ action: 'points', op: 'add' }, configRaw)
  assert.equal(config.nextConfigVersion, 2)
  assert.deepEqual(config.changedPointIds, ['pA', 'pB', 'pC'])
  assert.equal('points' in config, false)
  assert.equal('connections' in config, false)
  assert.equal('workspace' in config, false)
  assert.ok(utf8ByteLength(config) <= AGENT_TEXT_CAPS.threePointConfigCommitBytes, '3-point commit ≤8KiB')
})

