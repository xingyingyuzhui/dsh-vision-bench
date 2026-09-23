import assert from 'node:assert/strict'
import test from 'node:test'
import { listPendingWrites, resolvePendingWrite } from '../../bench-actions.mjs'
import { loadWorkspace, workspaceRepository } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { writeLocks } from '../../src/application/modbus/modbus-runtime-context.mjs'
import { modbusForSession } from '../../src/application/modbus/workspace-session-view.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

const tcp = {
  id: 'c1',
  name: 'C1',
  role: 'client',
  enabled: true,
  conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502, sim: false },
}
const device = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
const point = (id) => ({
  id,
  connectionId: 'c1',
  deviceId: 'd1',
  area: 'holdingRegister',
  function: 3,
  address: 0,
  name: id,
})

test('approving after a same-address point id change is CONFIG_DRIFT and does not touch the bus', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-approve-point-drift-' })
  const { home, cwd } = bench
  bench.save({
    modbus: { version: 3, connections: [tcp], devices: [device], points: [point('p1')], values: [] },
  })
  const first = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [4] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  assert.deepEqual(first.request.pointIds, ['p1'])
  const before = loadWorkspace(home, cwd).modbus.configVersion || 1
  const patched = await workspaceRepository(home).update(cwd, null, async (current) => {
    const session = current.modbus && current.modbus.sessionConfigs && current.modbus.sessionConfigs.s1
    if (!session) return { ok: false, error: 'session s1 was not claimed' }
    return {
      ok: true,
      workspace: {
        ...current,
        modbus: {
          ...current.modbus,
          sessionConfigs: {
            ...current.modbus.sessionConfigs,
            s1: { ...session, points: [point('p2')] },
          },
        },
      },
    }
  })
  assert.equal(patched.ok, true, patched.error)
  const after = loadWorkspace(home, cwd).modbus.configVersion || 1
  assert.equal(after, before, 'this regression is the point-id swap that does not bump configVersion')
  const ids = modbusForSession(loadWorkspace(home, cwd), 's1').points.map((item) => item.id)
  assert.deepEqual(ids, ['p2'])
  let calls = 0
  const ran = await resolvePendingWrite(home, cwd, first.requestId, true, {
    sessionId: 's1',
    transport: {
      write: async () => {
        calls += 1
        return { ok: true, data: [4] }
      },
      read: async () => ({ ok: true, data: [4] }),
    },
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'CONFIG_DRIFT')
  assert.equal(calls, 0)
})

test('approving while a write lock is held returns WRITE_BUSY and keeps the request', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-approve-busy-' })
  const { home, cwd } = bench
  bench.save({
    modbus: { version: 3, connections: [tcp], devices: [device], points: [point('p1')], values: [] },
  })
  const first = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [4] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  writeLocks.add(cwd)
  t.after(() => writeLocks.delete(cwd))
  const ran = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: 's1' })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'WRITE_BUSY')
  assert.ok(listPendingWrites(cwd, 's1').some((item) => item.id === first.requestId))
})
