import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { saveWorkspace, loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'
import { resolvePointDevice } from '../../src/domain/modbus/device-identity.mjs'

/**
 * Private layers may each own deviceId=d1. Requests must hit the right unitId.
 * Injected transport returns a value derived from unitId so we can prove routing.
 */
function unitAwareTransport() {
  /** @type {Array<{ connectionId: string, unitId: number, address: number }>} */
  const requests = []
  return {
    requests,
    async open() {},
    async read(req) {
      const unitId = Number(req?.unitId ?? 1)
      const address = Number(req?.address || 0)
      const connectionId = String(req?.connectionId || '')
      requests.push({ connectionId, unitId, address })
      return { ok: true, data: [unitId * 1000 + address] }
    },
  }
}

test('private same-name devices route by unitId on real requests', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dev-priv-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('pA', 'c1', 'd1', 0)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d1', 'c2', 2)],
          points: [hrPoint('pB', 'c2', 'd1', 0)],
        },
      },
    },
  })
  const transport = unitAwareTransport()
  const ran = await modbusPoll(home, cwd, { transport })
  assert.equal(ran.ok, true, ran.error)
  const units = transport.requests.map((r) => r.unitId).sort()
  assert.deepEqual(units, [1, 2], `requests=${JSON.stringify(transport.requests)}`)
  const vA = ran.values.find((v) => (v.pointId || v.key) === 'pA')
  const vB = ran.values.find((v) => (v.pointId || v.key) === 'pB')
  assert.ok(vA && vB)
  assert.equal(vA.connectionId, 'c1')
  assert.equal(vB.connectionId, 'c2')
  assert.equal(vA.deviceId, 'd1')
  assert.equal(vB.deviceId, 'd1')
  assert.equal(vA.raw, 1000)
  assert.equal(vB.raw, 2000)
})

test('cross-connection deviceId reference is rejected before I/O', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dev-xconn-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c2', 2)],
      points: [hrPoint('pX', 'c1', 'd1', 0)],
    },
  })
  const transport = unitAwareTransport()
  const beforeReq = transport.requests.length
  const ran = await modbusPoll(home, cwd, { transport })
  assert.equal(ran.ok, false)
  assert.match(String(ran.error || ran.reason || ''), /deviceId|unitId|连接|设备/)
  assert.equal(transport.requests.length, beforeReq, '0 transport reads')
})

test('resolvePointDevice: missing / multi / mismatch', () => {
  const pack = {
    devices: [
      { id: 'd1', connectionId: 'c1', unitId: 1 },
      { id: 'd2', connectionId: 'c2', unitId: 2 },
      { id: 'dup', connectionId: 'c1', unitId: 1 },
      { id: 'dup', connectionId: 'c1', unitId: 9 },
    ],
  }
  const ok = resolvePointDevice(pack, { id: 'p', deviceId: 'd1' }, 'c1')
  assert.equal(ok.ok, true)
  const missing = resolvePointDevice(pack, { id: 'p', deviceId: 'nope' }, 'c1')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'DEVICE_NOT_FOUND')
  const multi = resolvePointDevice(pack, { id: 'p', deviceId: 'dup' }, 'c1')
  assert.equal(multi.ok, false)
  assert.equal(multi.errorCode, 'AMBIGUOUS_OWNER')
  const mismatch = resolvePointDevice(pack, { id: 'p', deviceId: 'd2' }, 'c1')
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.errorCode, 'TARGET_MISMATCH')
})

test('same connection two devices same address route distinct unitIds', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dev-2u-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1), device('d2', 'c1', 2)],
      points: [
        hrPoint('p1', 'c1', 'd1', 0),
        hrPoint('p2', 'c1', 'd2', 0),
      ],
    },
  })
  const transport = unitAwareTransport()
  const ran = await modbusPoll(home, cwd, { transport })
  assert.equal(ran.ok, true, ran.error)
  const reqs = transport.requests.map((r) => `${r.connectionId}/${r.unitId}@${r.address}`).sort()
  assert.deepEqual(reqs, ['c1/1@0', 'c1/2@0'], `requests=${JSON.stringify(transport.requests)}`)
  const v1 = ran.values.find((v) => (v.pointId || v.key) === 'p1')
  const v2 = ran.values.find((v) => (v.pointId || v.key) === 'p2')
  assert.equal(v1.raw, 1000, 'p1 must come from unit1')
  assert.equal(v2.raw, 2000, 'p2 must come from unit2')
  assert.equal(v1.deviceId, 'd1')
  assert.equal(v2.deviceId, 'd2')
})

test('missing deviceId is DEVICE_NOT_FOUND with zero I/O', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dev-noid-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [{ ...hrPoint('pX', 'c1', 'd1', 0), deviceId: '' }],
    },
  })
  const transport = unitAwareTransport()
  const ran = await modbusPoll(home, cwd, { transport })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'DEVICE_NOT_FOUND')
  assert.equal(transport.requests.length, 0)
})

test('second target device error aborts before any transport read', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-dev-2nd-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('ok1', 'c1', 'd1', 0)],
        },
        b: {
          connections: [rtuSim('c2', 'COM4')],
          devices: [device('d2', 'c2', 1)],
          points: [hrPoint('bad', 'c2', 'nope', 0)],
        },
      },
    },
  })
  const transport = unitAwareTransport()
  const before = loadWorkspace(home, cwd)
  const ran = await modbusPoll(home, cwd, { transport })
  assert.equal(ran.ok, false)
  assert.equal(transport.requests.length, 0)
  const after = loadWorkspace(home, cwd)
  assert.deepEqual(after.modbus.values, before.modbus.values)
})
