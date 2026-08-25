// Task3/0.19.2: connection lifecycle — client error/close handling is idempotent,
// never crashes the process, releases COM, and reconnection works; expected
// closes are not mislabeled as errors; one slot's failure never touches others.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createConnectionManager } from '../runtime/io/connection-manager.mjs'

let clientCount = 0
function makeClient({ autoError = null } = {}) {
  const listeners = { error: [], close: [] }
  const client = {
    id: ++clientCount,
    listeners,
    failReads: false,
    setID() {}, setTimeout() {},
    isDebugEnabled: true,
    on(ev, fn) { (listeners[ev] ||= []).push(fn) },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn) },
    listenerCount(ev) { return (listeners[ev] || []).length },
    connectTCP: async () => {},
    connectRTUBuffered: async () => {},
    close(cb) { cb && cb() },
    readHoldingRegisters: async function () {
      if (this.failReads) { const e = new Error('IO timeout'); e.code = 'ETIMEDOUT'; throw e }
      return { data: [1] }
    },
    emit(ev, arg) { for (const fn of [...(listeners[ev] || [])]) fn(arg) },
  }
  if (autoError) setTimeout(() => client.emit('error', new Error(autoError)), 0)
  const RTU = function () { return client }
  return { client, RTU }
}

// factory: every `new RTU()` yields a FRESH client (mirrors real modbus-serial)
function makeFactory() {
  const made = []
  const RTU = function () {
    const client = makeClient()
    made.push(client.client)
    return client.client
  }
  return { RTU, made }
}

const endpoint = (port = 'COM3') => ({ mode: 'rtu', port, baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
const req = (over = {}) => ({ cwd: '/ws', connectionId: 'c1', source: 'manual', sessionId: '', toolCallId: '', ...over })
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

test('client error: slot goes error, COM released, worker-side manager stays alive, reconnect works', async () => {
  const fake = makeFactory()
  const mgr = createConnectionManager({ ModbusRTU: fake.RTU })
  await mgr.openConnection(req(), endpoint(), undefined)
  assert.equal(mgr.connections.get('/ws\0c1').liveState, 'connected')
  assert.equal(mgr.portOwners.has('COM3'), true)
  // simulate a USB pull: error then close, in the same tick
  fake.made[0].emit('error', new Error('USB 拔出'))
  fake.made[0].emit('close')
  await tick(60)
  const slot = mgr.connections.get('/ws\0c1')
  assert.equal(slot.liveState, 'error', 'unexpected disconnect shows error state')
  assert.equal(slot.liveError.includes('USB 拔出'), true)
  assert.equal(mgr.portOwners.has('COM3'), false, 'COM released after error')
  // reconnect on the SAME manager (worker holds no global client)
  const before = mgr.connections.get('/ws\0c1').client
  assert.equal(before, null, 'client cleared after error')
  await mgr.openConnection(req(), endpoint(), undefined)
  assert.equal(mgr.connections.get('/ws\0c1').liveState, 'connected', 'reconnect works after error')
  await mgr.stop()
})

test('error + close pair finalizes exactly once (idempotent teardown)', async () => {
  const fake = makeFactory()
  const mgr = createConnectionManager({ ModbusRTU: fake.RTU })
  await mgr.openConnection(req(), endpoint(), undefined)
  const slot = mgr.connections.get('/ws\0c1')
  const client = fake.made[0]
  client.emit('error', new Error('x'))
  client.emit('close')
  await tick(40)
  assert.equal(slot.liveState, 'error')
  assert.equal(slot.client, null)
  // emit again — must be a no-op (listeners removed / finalized)
  client.emit('close')
  await tick(20)
  assert.equal(slot.client, null)
  await mgr.stop()
})

test('expected close is NOT an error; repeated connect/disconnect leaves no listener growth', async () => {
  const makemgr = () => createConnectionManager({ ModbusRTU: makeFactory().RTU })
  const mgr = makemgr()
  for (let i = 0; i < 3; i++) {
    await mgr.openConnection(req(), endpoint(), undefined)
    const slot = mgr.connections.get('/ws\0c1')
    assert.equal(slot.liveState, 'connected', 'cycle ' + i + ' connected')
    const before = slot.client ? slot.client.listenerCount('error') + slot.client.listenerCount('close') : 0
    await mgr.closeConnection('/ws', 'c1')
    assert.equal(slot.liveState, 'disconnected')
    assert.equal(slot.client, null)
    assert.ok(before <= 2, 'listeners bounded per client')
  }
  await mgr.stop()
})

test('one connection error does not affect another connection', async () => {
  const a = makeFactory()
  const mgrA = createConnectionManager({ ModbusRTU: a.RTU })
  await mgrA.openConnection(req({ connectionId: 'c1' }), endpoint('COM3'), undefined)
  await mgrA.openConnection(req({ connectionId: 'c2' }), endpoint('COM4'), undefined)
  const c1Client = a.made[0]
  c1Client.emit('error', new Error('COM3 故障'))
  await tick(40)
  assert.equal(mgrA.connections.get('/ws\0c1').liveState, 'error')
  assert.equal(mgrA.connections.get('/ws\0c2').liveState, 'connected', 'c2 unaffected')
  assert.equal(mgrA.portOwners.has('COM4'), true)
  assert.equal(mgrA.portOwners.has('COM3'), false)
  await mgrA.stop()
})