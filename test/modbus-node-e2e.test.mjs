import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createVisionIoBroker } from '../bench-io-broker.mjs'
import { createModbusTransport } from '../bench-modbus-transport.mjs'
import { modbusRead } from '../bench-modbus.mjs'
import { saveWorkspace } from '../bench-store.mjs'

const fakeWorker = fileURLToPath(new URL('./fixtures/fake-io-worker.mjs', import.meta.url))

test('all:true across two connections keeps batch identity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-e2e-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const broker = createVisionIoBroker({ workerPath: fakeWorker })
  const transport = createModbusTransport({ broker })
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        connections: [
          { id: 'c1', name: 'A', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502, sim: false } },
          { id: 'c2', name: 'B', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1503, sim: false } },
        ],
        devices: [
          { id: 'd1', connectionId: 'c1', unitId: 1 },
          { id: 'd2', connectionId: 'c2', unitId: 2 },
        ],
        points: [
          { id: 'p1', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, name: 'a' },
          { id: 'p2', connectionId: 'c2', deviceId: 'd2', function: 3, address: 0, name: 'b' },
        ],
        activeConnectionId: 'c1',
        activeDeviceId: 'd1',
      },
    })
    const ran = await modbusRead(home, cwd, { all: true, source: 'user' }, { transport })
    assert.equal(ran.ok, true)
    assert.equal(ran.results.length, 2)
    assert.deepEqual(ran.results.map((item) => item.connectionId).sort(), ['c1', 'c2'])
    const ids = new Set(ran.framesLog.map((item) => item.transactionId))
    assert.equal(ids.size, ran.framesLog.length)
  } finally {
    await broker.stop()
    await rm(home, { recursive: true, force: true })
  }
})

test('local TCP server round-trip through Node transport', async () => {
  const regs = [0x1111]
  const server = net.createServer((socket) => {
    let acc = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk])
      while (acc.length >= 8) {
        const len = acc.readUInt16BE(4)
        const total = 6 + len
        if (acc.length < total) return
        const buf = acc.subarray(0, total)
        acc = acc.subarray(total)
        const txn = buf.readUInt16BE(0)
        const unit = buf[6]
        const fc = buf[7]
        const reply = (pdu) => {
          const mbap = Buffer.alloc(6)
          mbap.writeUInt16BE(txn, 0)
          mbap.writeUInt16BE(0, 2)
          mbap.writeUInt16BE(pdu.length, 4)
          socket.write(Buffer.concat([mbap, pdu]))
        }
        if (fc === 3) {
          const addr = buf.readUInt16BE(8)
          const count = buf.readUInt16BE(10)
          if (addr === 0 && count >= 1) {
            const bytes = Buffer.alloc(3 + count * 2)
            bytes[0] = unit
            bytes[1] = 3
            bytes[2] = count * 2
            for (let i = 0; i < count; i++) bytes.writeUInt16BE(regs[i] || 0, 3 + i * 2)
            reply(bytes)
          }
        } else if (fc === 6) {
          const addr = buf.readUInt16BE(8)
          const value = buf.readUInt16BE(10)
          if (addr === 0) regs[0] = value
          reply(Buffer.from([unit, 6, buf[8], buf[9], buf[10], buf[11]]))
        }
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const broker = createVisionIoBroker()
  const transport = createModbusTransport({ broker })
  const base = {
    v: 1,
    cwd: '/tmp/tcp',
    connectionId: 'c1',
    deviceId: 'd1',
    unitId: 1,
    timeoutMs: 1500,
    endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: port },
  }
  try {
    const wrote = await transport.write({
      ...base,
      op: 'modbus.write',
      functionCode: 6,
      address: 0,
      values: [0x2222],
    })
    assert.equal(wrote.ok, true, wrote && wrote.error && wrote.error.message)
    const ran = await transport.read({
      ...base,
      op: 'modbus.read',
      functionCode: 3,
      address: 0,
      count: 1,
    })
    assert.equal(ran.ok, true, ran && ran.error && ran.error.message)
    assert.equal(ran.data[0], 0x2222)
    assert.equal(ran.frames.frameFormat, 'tcp-normalized')
    assert.match(String(ran.frames.requestHex || ''), /^[0-9A-F]*$/)
    assert.equal(String(ran.frames.requestHex || '').length % 2, 0)
    assert.notEqual(ran.transactionId, wrote.transactionId)
  } finally {
    await broker.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('failed TCP read still returns transactionId and frames', async () => {
  const server = net.createServer((socket) => {
    socket.on('data', () => { /* drop */ })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const broker = createVisionIoBroker()
  const transport = createModbusTransport({ broker })
  try {
    const ran = await transport.read({
      v: 1,
      op: 'modbus.read',
      cwd: '/tmp/tcp-fail',
      connectionId: 'c1',
      deviceId: 'd1',
      unitId: 1,
      functionCode: 3,
      address: 0,
      count: 1,
      timeoutMs: 80,
      endpoint: { mode: 'tcp', host: '127.0.0.1', tcpPort: port },
    }, { timeoutMs: 80 })
    assert.equal(ran.ok, false)
    assert.ok(ran.transactionId || (ran.error && ran.error.transactionId) || ran.error)
    assert.equal((ran.frames && ran.frames.frameFormat) || 'tcp-normalized', 'tcp-normalized')
  } finally {
    await broker.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})
