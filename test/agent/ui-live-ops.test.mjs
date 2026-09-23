import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, modbusWrite, resolvePendingWrite } from '../../bench-modbus.mjs'
import { agentRefToText, buildAgentRef } from '../../bench-shared.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { projectModbusForSession } from '../../src/application/modbus/config-scope-service.mjs'
import { saveSessionModbusPatch } from '../../src/application/modbus/workspace-session-view.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { agentDevice, agentHrPoint, agentRtu } from './ui-fixtures.mjs'

test('buildAgentRef produces stable ID+configVersion+timeRange and read/write error codes', async (t) => {
  const ref = buildAgentRef(
    'point',
    { pointId: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T' },
    { configVersion: 3, start: 1000, end: 2000 },
  )
  assert.equal(ref.kind, 'point')
  assert.equal(ref.pointId, 'p1')
  assert.equal(ref.connectionId, 'c1')
  assert.equal(ref.configVersion, 3)
  assert.deepEqual(ref.timeRange, { start: 1000, end: 2000 })
  const text = agentRefToText(ref)
  assert.match(text, /point/)
  assert.match(text, /c1/)

  const bench = await createBench(t, { prefix: 'dvb-agent-codes-' })
  const { home, cwd } = bench
  const c1 = agentRtu('c1', 'COM9', { name: 'C1', enabled: false })
  const d1 = agentDevice('d1', 'c1', 1, 'D1')
  const p1 = agentHrPoint('p1', 'c1', 'd1', 0)
  bench.save({ modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
  const ran = await modbusWrite(home, cwd, {
    source: 'agent',
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: 0,
    values: [1],
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, ERROR_CODES.DEVICE_DISABLED)

  const cSim = agentRtu('c1', 'COM9', { name: 'C1' })
  bench.save({ modbus: { version: 3, connections: [cSim], devices: [d1], points: [p1] } })
  const first = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  const cDrift = agentRtu('c1', 'COM11', { name: 'C1' })
  const driftedPatch = await saveSessionModbusPatch(home, cwd, 's1', { modbus: { connections: [cDrift] } })
  assert.equal(driftedPatch.ok, true, driftedPatch.error)
  const drifted = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: 's1' })
  assert.equal(drifted.ok, false)
  assert.equal(drifted.errorCode, ERROR_CODES.ENDPOINT_DRIFT)
})

test('Agent live ops need deviceId on multi-device connections; pending write binds unit/config; reject safe; unit drift voids (§16.5-30/31/32/33)', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-agent-n4-' })
  const { home, cwd } = bench
  const c1 = agentRtu('c1', 'COM3', { name: 'C1' })
  const p1 = agentHrPoint('p1', 'c1', 'd1', 0, { name: 'T1' })
  bench.save({
    modbus: {
      version: 3,
      connections: [c1],
      devices: [agentDevice('d1', 'c1', 1, 'D1'), agentDevice('d2', 'c1', 2, 'D2')],
      points: [p1],
    },
  })
  const readMissing = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', function: 3, address: 0 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(readMissing.errorCode, ERROR_CODES.TARGET_REQUIRED)
  const writeMissing = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', function: 3, address: 0, values: [1] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(writeMissing.errorCode, ERROR_CODES.TARGET_REQUIRED)
  const first = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  assert.equal(first.request.deviceId, 'd1')
  assert.deepEqual(first.request.pointIds, ['p1'])
  assert.equal(first.request.endpoint.configVersion, loadWorkspace(home, cwd).modbus.configVersion)
  assert.equal(first.request.endpoint.unitId, 1)
  assert.equal((await resolvePendingWrite(home, cwd, first.requestId, false, { sessionId: 's1' })).rejected, true)
  assert.equal((loadWorkspace(home, cwd).modbus.values || []).length, 0)
  const second = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [6] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  const unitPatch = await saveSessionModbusPatch(home, cwd, 's1', {
    modbus: {
      devices: projectModbusForSession(loadWorkspace(home, cwd).modbus, 's1').devices.map((d) =>
        d.id === 'd1' ? { ...d, unitId: 3 } : d,
      ),
    },
  })
  assert.equal(unitPatch.ok, true, unitPatch.error)
  const driftedUnit = await resolvePendingWrite(home, cwd, second.requestId, true, { sessionId: 's1' })
  assert.equal(driftedUnit.ok, false)
  assert.equal(driftedUnit.errorCode, ERROR_CODES.ENDPOINT_DRIFT)
})
