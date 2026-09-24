// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { ensureWorkspaceClaimed } from '../../src/application/modbus/workspace-session-view.mjs'
import { connection, createBench, pointSeries } from '../helpers/workspace-factory.mjs'

test('status and points list agree after claim; other session stays isolated', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-status-scope-' })
  const { home, cwd } = bench
  const conn = connection('real-c1', 'tcp', '', { sim: true })
  const points = pointSeries('hr', 16, { connectionId: 'real-c1', deviceId: 'real-d1' }).map((p, i) => ({
    ...p,
    id: `p${i}`,
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 7,
      connections: [conn],
      devices: [{ id: 'real-d1', connectionId: 'real-c1', name: 'D1', unitId: 1 }],
      points,
    },
  })

  const originA = { source: 'agent', sessionId: 'session-a' }
  const statusA = await runVisionBench(home, { action: 'status' }, cwd, originA)
  assert.equal(statusA.ok, true, statusA.error)
  assert.equal(statusA.configVersion, 7)
  assert.equal(statusA.modbus.configVersion, 7)
  assert.equal(statusA.modbus.points.length, 16)

  const listA = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, originA)
  assert.equal(listA.ok, true, listA.error)
  assert.equal(listA.configVersion, statusA.configVersion)
  assert.deepEqual(
    listA.points.map((/** @type {any} */ p) => p.id).sort(),
    statusA.modbus.points.map((/** @type {any} */ p) => p.id).sort(),
  )
  assert.deepEqual(
    statusA.modbus.connections.map((/** @type {any} */ c) => c.id).sort(),
    ['real-c1'],
  )
  assert.deepEqual(
    statusA.modbus.devices.map((/** @type {any} */ d) => d.id).sort(),
    ['real-d1'],
  )
  // status/list must not persist claim — flat layer stays until a write path claims.
  assert.equal(loadWorkspace(home, cwd).modbus.points?.length || 0, 16)
  assert.equal(loadWorkspace(home, cwd).modbus.privateClaimSessionId || '', '')

  const statusBPreview = await runVisionBench(home, { action: 'status' }, cwd, {
    source: 'agent',
    sessionId: 'session-b',
  })
  assert.equal(statusBPreview.ok, true, statusBPreview.error)
  assert.equal(statusBPreview.modbus.points.length, 16)

  await ensureWorkspaceClaimed(home, cwd, 'session-a')
  assert.equal(loadWorkspace(home, cwd).modbus.points?.length || 0, 0, 'claimed topology leaves flat layer empty')

  const statusB = await runVisionBench(home, { action: 'status' }, cwd, {
    source: 'agent',
    sessionId: 'session-b',
  })
  assert.equal(statusB.ok, true, statusB.error)
  assert.deepEqual(statusB.modbus.points, [])
  assert.ok(
    !statusB.modbus.connections.some((/** @type {any} */ c) => c.id === 'real-c1'),
    'other session must not see claimed private connection',
  )
  assert.ok(!statusB.modbus.devices.some((/** @type {any} */ d) => d.id === 'real-d1'))

  const listB = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, {
    source: 'agent',
    sessionId: 'session-b',
  })
  assert.equal(listB.ok, true, listB.error)
  assert.deepEqual(listB.points, [])

  const anon = await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent' })
  assert.equal(anon.ok, false)
  assert.equal(anon.errorCode, ERROR_CODES.SESSION_REQUIRED)
})
