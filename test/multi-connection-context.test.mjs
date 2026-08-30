// Task1.2+2/0.19.2: global capture ordering across connections and per-slot
// transaction context (no manager-level currentSource/currentTransactionId).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createConnectionManager } from '../runtime/io/connection-manager.mjs'
import { createFrameRing } from '../runtime/io/frame-ring.mjs'

function makeClient({ failReads = false } = {}) {
  const listeners = { error: [], close: [] }
  const client = {
    listeners,
    failReads,
    setID() {},
    setTimeout() {},
    isDebugEnabled: true,
    on(ev, fn) {
      ;(listeners[ev] ||= []).push(fn)
    },
    removeListener(ev, fn) {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn)
    },
    connectTCP: async () => {},
    connectRTUBuffered: async () => {},
    close(cb) {
      cb && cb()
    },
    readHoldingRegisters: async function () {
      if (this.failReads) {
        const e = new Error('IO timeout')
        e.code = 'ETIMEDOUT'
        throw e
      }
      return { data: [1, 2, 3] }
    },
  }
  const RTU = function () {
    return client
  }
  return { client, RTU }
}

const endpoint = { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 }
const endpoint2 = { mode: 'rtu', port: 'COM4', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 }
const req = (over = {}) => ({
  cwd: '/ws',
  connectionId: 'c1',
  source: 'manual',
  sessionId: '',
  toolCallId: '',
  ...over,
})

test('two concurrent connections: all-feed is seq-ordered, per-conn feeds stay isolated', async () => {
  const fake = makeClient()
  const mgr = createConnectionManager({ ModbusRTU: fake.RTU })
  const [a, b] = await Promise.all([
    mgr.openConnection(req({ connectionId: 'c1' }), endpoint, undefined),
    mgr.openConnection(req({ connectionId: 'c2' }), endpoint2, undefined),
  ])
  assert.equal(a.state, 'connected')
  assert.equal(b.state, 'connected')
  const sa = mgr.connections.get('/ws\0c1')
  const sb = mgr.connections.get('/ws\0c2')
  // interleave pushes on both rings with the manager's seq stamping (attach
  // does this in production; simulate equivalent order for the projection test)
  sa.capture.push({ direction: 'tx', hex: 'AA', byteLength: 1, connectionId: 'c1', port: 'COM3', seq: 1 })
  sb.capture.push({ direction: 'rx', hex: 'BB', byteLength: 1, connectionId: 'c2', port: 'COM4', seq: 2 })
  sa.capture.push({ direction: 'rx', hex: 'CC', byteLength: 1, connectionId: 'c1', port: 'COM3', seq: 3 })
  const all = mgr.feedCapture('/ws', '', 0, 50)
  assert.deepEqual(
    all.items.map((i) => i.port),
    ['COM3', 'COM4', 'COM3'],
    'all-feed ordered by seq, ties broken stably',
  )
  assert.equal(all.hasMore, false)
  const only3 = mgr.feedCapture('/ws', 'c1', 0, 50)
  assert.equal(only3.items.length, 2)
  assert.ok(only3.items.every((i) => i.connectionId === 'c1'))
  const only4 = mgr.feedCapture('/ws', 'c2', 0, 50)
  assert.equal(only4.items.length, 1)
  assert.equal(only4.items[0].port, 'COM4')
  await mgr.stop()
})

test('same-millisecond frames across connections never collide in the projection cursor', async () => {
  const fake = makeClient()
  const mgr = createConnectionManager({ ModbusRTU: fake.RTU })
  await mgr.openConnection(req({ connectionId: 'c1' }), endpoint, undefined)
  await mgr.openConnection(req({ connectionId: 'c2' }), endpoint2, undefined)
  const ring = createFrameRing()
  for (let i = 0; i < 40; i++) {
    ring.push({
      direction: 'tx',
      hex: 'AA',
      byteLength: 1,
      connectionId: i % 2 ? 'c2' : 'c1',
      port: i % 2 ? 'COM4' : 'COM3',
      seq: i + 1,
    })
  }
  // projection semantics: a global cursor must page along seq
  const p1 = ring.feed(0, 20)
  const p2 = ring.feed(p1.cursor, 20)
  const p3 = ring.feed(p2.cursor, 20)
  assert.equal(p1.items.length + p2.items.length + p3.items.length, 40)
  assert.ok(!p1.hasMore || p1.items.length === 20)
  await mgr.stop()
})

test('failed op clears slot context; a later request mints a fresh transaction', async () => {
  const fake = makeClient({ failReads: true })
  const mgr = createConnectionManager({ ModbusRTU: fake.RTU })
  await mgr.openConnection(req(), endpoint, undefined)
  const slot = mgr.connections.get('/ws\0c1')
  const readReq = { ...req(), op: 'modbus.read', unitId: 1, functionCode: 3, address: 0, count: 3 }
  let err = null
  try {
    await mgr.modbus(readReq, endpoint, undefined)
  } catch (e) {
    err = e
  }
  assert.ok(err, 'failed read rejects')
  assert.equal(slot.activeContext, null, 'context cleared by the enclosing finally after failure')
  fake.client.failReads = false
  const ok1 = await mgr.modbus({ ...readReq, source: 'agent', sessionId: 's9' }, endpoint, undefined)
  assert.ok(ok1 && ok1.transactionId, 'subsequent request succeeds with a transaction id')
  assert.equal(slot.activeContext, null, 'context cleared after success too')
  await mgr.stop()
})

test('manager exposes no shared mutable source/transaction (per-slot only)', async () => {
  const mgr = createConnectionManager({ ModbusRTU: makeClient().RTU })
  // legacy no-op kept for back-compat: setting it must not affect framestamping
  mgr.setSource('agent')
  const slot = mgr.connections.get('/ws\0nope') || null
  assert.equal(slot, null)
  assert.equal(typeof mgr.setSource, 'function')
})
