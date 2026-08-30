import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { endpointFingerprint, toEndpoint } from '../bench-io-contract.mjs'
import { createModbusTransport, toReadRequest, toWriteRequest } from '../bench-modbus-transport.mjs'
import { modbusRead, modbusWrite } from '../bench-modbus.mjs'
import { saveWorkspace } from '../bench-store.mjs'

test('toReadRequest copies device unitId and omits it from endpoint fingerprint', async () => {
  const conn = { id: 'c1', conn: { mode: 'rtu', port: 'COM3', baudrate: 19200, bytesize: 8, parity: 'E', stopbits: 1 } }
  const d1 = { id: 'd1', unitId: 1 }
  const d2 = { id: 'd2', unitId: 2 }
  const a = toReadRequest({ cwd: '/ws', connection: conn, device: d1, batch: { fc: 3, address: 0, count: 2 } })
  const b = toReadRequest({ cwd: '/ws', connection: conn, device: d2, batch: { fc: 3, address: 0, count: 2 } })
  assert.equal(endpointFingerprint(a.endpoint), endpointFingerprint(b.endpoint))
  assert.equal(a.unitId, 1)
  assert.equal(b.unitId, 2)
  const odd = toEndpoint({ conn: { ...conn.conn, stopbits: 2 } })
  assert.notEqual(endpointFingerprint(a.endpoint), endpointFingerprint(odd))
})

test('transport assigns a unique request id before validating', async () => {
  const seen = []
  const transport = createModbusTransport({
    broker: {
      request: async (payload) => {
        seen.push(payload)
        return {
          ok: true,
          data: [1],
          transactionId: 'w:1',
          frames: { requestHex: '', responseHex: '', frameFormat: 'tcp-normalized' },
        }
      },
      health: async () => ({ ok: true, data: {} }),
    },
  })
  const req = toReadRequest({
    cwd: '/ws',
    connection: { id: 'c1', conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
    device: { id: 'd1', unitId: 1 },
    batch: { fc: 3, address: 0, count: 1 },
  })
  assert.equal(req.id, undefined)
  const ran = await transport.read(req)
  assert.equal(ran.ok, true)
  assert.equal(seen.length, 1)
  assert.equal(typeof seen[0].id, 'string')
  assert.ok(seen[0].id)
})

test('10k simulated transaction ids do not collide', async () => {
  const transport = createModbusTransport({
    broker: {
      request: async () => {
        throw new Error('sim must not hit broker')
      },
      health: async () => ({ ok: true, data: {} }),
    },
  })
  const ids = new Set()
  for (let i = 0; i < 10000; i++) {
    const ran = await transport.read(
      {
        v: 1,
        op: 'modbus.read',
        address: i % 10,
        count: 1,
        functionCode: 3,
        endpoint: { mode: 'rtu', port: 'COM3' },
      },
      { sim: true },
    )
    ids.add(ran.transactionId)
  }
  assert.equal(ids.size, 10000)
})

test('toWriteRequest rejects via validate before physical I/O for unit 0', async () => {
  const transport = createModbusTransport({
    broker: {
      request: async () => {
        throw new Error('should not run')
      },
      health: async () => ({ ok: true, data: {} }),
    },
  })
  const req = toWriteRequest({
    cwd: '/ws',
    connection: { id: 'c1', conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
    device: { id: 'd1', unitId: 0 },
    point: { address: 1, function: 3 },
    values: [1],
    fc: 6,
  })
  const ran = await transport.write(req)
  assert.equal(ran.ok, false)
  assert.ok(ran.error && ran.error.code)
})

test('sim write/read freeze before/target/readback and shared transaction fields', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-tx-freeze-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        conn: { sim: true },
        points: Array.from({ length: 10 }, (_, i) => ({ name: 'HR' + i, function: 3, address: i })),
      },
    })
    const ran = await modbusWrite(home, cwd, { source: 'user', function: 3, address: 2, values: [1234] })
    assert.equal(ran.ok, true)
    assert.deepEqual(ran.before, [null])
    assert.deepEqual(ran.target, [1234])
    assert.deepEqual(ran.readback, [1234])
    assert.ok(ran.taskId)
    assert.equal(ran.source, 'user')
    const frame = ran.framesLog && ran.framesLog[0]
    assert.ok(frame)
    assert.equal(frame.transactionId, frame.frameId)
    assert.equal(frame.connectionId, ran.connectionId)
    assert.ok(Array.isArray(ran.framesLog))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
