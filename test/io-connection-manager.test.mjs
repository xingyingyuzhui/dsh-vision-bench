import assert from 'node:assert/strict'
import test from 'node:test'
import { createConnectionManager } from '../runtime/io/connection-manager.mjs'
import { createFrameRing } from '../runtime/io/frame-ring.mjs'
import { attachRtuCapture } from '../runtime/io/rtu-capture-adapter.mjs'

function FakeModbusRTU() {
  this.calls = []
  this.closed = false
  this.port = ''
}
FakeModbusRTU.prototype.setID = function setID(id) {
  this.id = id
}
FakeModbusRTU.prototype.setTimeout = function setTimeout() {}
Object.defineProperty(FakeModbusRTU.prototype, 'isDebugEnabled', {
  get() {
    return true
  },
  set() {},
})
FakeModbusRTU.prototype.connectTCP = async function connectTCP() {
  this.mode = 'tcp'
}
FakeModbusRTU.prototype.connectRTUBuffered = async function connectRTUBuffered(port) {
  if (port === 'FAIL') {
    const err = new Error('open fail')
    err.code = 'ENOENT'
    throw err
  }
  this.port = port
  this.mode = 'rtu'
}
FakeModbusRTU.prototype.readHoldingRegisters = async function readHoldingRegisters(addr, count) {
  this.calls.push(['read', this.id, addr, count])
  return {
    data: Array.from({ length: count }, () => 1),
    request: new Uint8Array([1, 3]),
    responses: [new Uint8Array([1, 3, 2, 0, 1])],
  }
}
FakeModbusRTU.prototype.writeRegister = async function writeRegister(addr, value) {
  this.calls.push(['write', this.id, addr, value])
  return { data: [value], request: new Uint8Array([1, 6]), responses: [new Uint8Array([1, 6])] }
}
FakeModbusRTU.prototype.close = function close(cb) {
  this.closed = true
  if (cb) cb()
}

const req = (over = {}) => ({
  v: 1,
  cwd: '/ws',
  connectionId: 'c1',
  deviceId: 'd1',
  unitId: 1,
  op: 'modbus.read',
  functionCode: 3,
  address: 0,
  count: 1,
  ...over,
})

test('COM3 to COM4 releases COM3 owner', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.modbus(req(), { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  assert.equal(mgr.portOwners.has('COM3'), true)
  await mgr.modbus(req(), { mode: 'rtu', port: 'COM4', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  assert.equal(mgr.portOwners.has('COM3'), false)
  assert.equal(mgr.portOwners.has('COM4'), true)
  await mgr.stop()
})

test('RTU to TCP releases old COM', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.modbus(req(), { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  await mgr.modbus(req(), { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 })
  assert.equal(mgr.portOwners.size, 0)
  await mgr.stop()
})

test('TCP to COM5 owns only COM5', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.modbus(req(), { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 })
  await mgr.modbus(req(), { mode: 'rtu', port: 'COM5', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  assert.deepEqual([...mgr.portOwners.keys()], ['COM5'])
  await mgr.stop()
})

test('open failure on new COM does not leave a stale owner', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.modbus(req(), { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  await assert.rejects(() =>
    mgr.modbus(req(), { mode: 'rtu', port: 'FAIL', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 }),
  )
  assert.equal(mgr.portOwners.has('FAIL'), false)
  assert.equal(mgr.portOwners.has('COM3'), false)
  await mgr.stop()
})

test('two connectionIds cannot share one COM', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.modbus(req({ connectionId: 'c1' }), {
    mode: 'rtu',
    port: 'COM3',
    baudrate: 9600,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
  })
  await assert.rejects(() =>
    mgr.modbus(req({ connectionId: 'c2' }), {
      mode: 'rtu',
      port: 'COM3',
      baudrate: 9600,
      bytesize: 8,
      parity: 'N',
      stopbits: 1,
    }),
  )
  await mgr.stop()
})

test('explicit open holds the port until close', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  const live = await mgr.openConnection(req(), {
    mode: 'rtu',
    port: 'COM3',
    baudrate: 9600,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
  })
  assert.equal(live.state, 'connected')
  assert.equal(mgr.portOwners.has('COM3'), true)
  await mgr.closeConnection('/ws', 'c1')
  assert.equal(mgr.portOwners.has('COM3'), false)
  await mgr.stop()
})

test('release uses slot-owned port, not a caller endpoint', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.modbus(req(), { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  await mgr.release('/ws', 'c1')
  assert.equal(mgr.portOwners.size, 0)
  await mgr.stop()
})

test('queued write aborted before run never calls writeRegister', async () => {
  const wrote = []
  function SlowRTU() {
    FakeModbusRTU.call(this)
  }
  SlowRTU.prototype = Object.create(FakeModbusRTU.prototype)
  SlowRTU.prototype.readHoldingRegisters = function () {
    return new Promise((resolve) =>
      setTimeout(() => resolve({ data: [1], request: new Uint8Array([1]), responses: [new Uint8Array([1])] }), 80),
    )
  }
  SlowRTU.prototype.writeRegister = async function (addr, value) {
    wrote.push([addr, value])
    return { data: [value] }
  }
  SlowRTU.prototype.connectRTUBuffered = FakeModbusRTU.prototype.connectRTUBuffered
  SlowRTU.prototype.close = FakeModbusRTU.prototype.close
  SlowRTU.prototype.setID = FakeModbusRTU.prototype.setID
  SlowRTU.prototype.setTimeout = FakeModbusRTU.prototype.setTimeout
  const mgr = createConnectionManager({ ModbusRTU: SlowRTU })
  const ep = { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 }
  const ac = new AbortController()
  const first = mgr.modbus(req({ op: 'modbus.read' }), ep)
  const second = mgr.modbus(req({ op: 'modbus.write', functionCode: 6, values: [9] }), ep, ac.signal)
  ac.abort()
  await first
  await assert.rejects(() => second)
  assert.deepEqual(wrote, [])
  await mgr.stop()
})

test('failed Modbus op still has transactionId and frames', async () => {
  function Boom() {
    FakeModbusRTU.call(this)
  }
  Boom.prototype = Object.create(FakeModbusRTU.prototype)
  Boom.prototype.connectRTUBuffered = FakeModbusRTU.prototype.connectRTUBuffered
  Boom.prototype.close = FakeModbusRTU.prototype.close
  Boom.prototype.setID = FakeModbusRTU.prototype.setID
  Boom.prototype.setTimeout = FakeModbusRTU.prototype.setTimeout
  Boom.prototype.readHoldingRegisters = async function () {
    const err = new Error('crc')
    err.modbusRequest = new Uint8Array([1, 3, 0, 0, 0, 1])
    throw err
  }
  const mgr = createConnectionManager({ ModbusRTU: Boom })
  try {
    await mgr.modbus(req(), { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
    assert.fail('expected throw')
  } catch (error) {
    assert.ok(error.transactionId)
    assert.ok(error.frames)
  }
  await mgr.stop()
})

test('RTU capture adapter records tx write and rx data on the same port', async () => {
  const seen = []
  const serial = {
    handlers: {},
    on(ev, fn) {
      this.handlers[ev] = fn
    },
    removeListener(ev) {
      delete this.handlers[ev]
    },
  }
  const port = {
    _client: serial,
    write(data) {
      this.last = data
      return true
    },
  }
  const client = { _port: port }
  const detach = attachRtuCapture(client, (dir, buf) => seen.push([dir, buf.toString('utf8')]))
  port.write(Buffer.from('abc'))
  serial.handlers.data(Buffer.from('def'))
  detach()
  assert.deepEqual(seen, [
    ['tx', 'abc'],
    ['rx', 'def'],
  ])
})

test('frame ring keeps unique ids and a new epoch after bump', async () => {
  const ring = createFrameRing()
  const a = ring.push({ direction: 'tx', hex: '01', byteLength: 1, connectionId: 'c1', port: 'COM3' })
  const epoch1 = ring.epoch
  ring.bumpEpoch()
  const b = ring.push({ direction: 'rx', hex: '02', byteLength: 1, connectionId: 'c1', port: 'COM3' })
  assert.notEqual(a.id, b.id)
  assert.notEqual(epoch1, ring.epoch)
  assert.notEqual(a.epoch, b.epoch)
})

test('held connection does not drop the COM after idle time', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.openConnection(req(), { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(mgr.portOwners.has('COM3'), true)
  assert.equal(mgr.status('/ws', 'c1').state, 'connected')
  await mgr.stop()
})

test('capture rings isolate COM3 from COM4 and all merges by time', async () => {
  const mgr = createConnectionManager({ ModbusRTU: FakeModbusRTU })
  await mgr.openConnection(req({ connectionId: 'c1' }), {
    mode: 'rtu',
    port: 'COM3',
    baudrate: 9600,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
  })
  await mgr.openConnection(req({ connectionId: 'c2' }), {
    mode: 'rtu',
    port: 'COM4',
    baudrate: 9600,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
  })
  const a = mgr.connections.get('/ws\0c1')
  const b = mgr.connections.get('/ws\0c2')
  a.capture.push({ direction: 'tx', hex: 'AA', byteLength: 1, connectionId: 'c1', port: 'COM3' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  b.capture.push({ direction: 'rx', hex: 'BB', byteLength: 1, connectionId: 'c2', port: 'COM4' })
  const only3 = mgr.feedCapture('/ws', 'c1', 0, 50)
  assert.equal(
    only3.lines.every((l) => l.connectionId === 'c1'),
    true,
  )
  assert.ok(!only3.lines.some((l) => l.port === 'COM4'))
  const all = mgr.feedCapture('/ws', '', 0, 50)
  assert.deepEqual(
    all.lines.map((l) => l.port),
    ['COM3', 'COM4'],
  )
  await mgr.closeConnection('/ws', 'c1')
  const after = mgr.feedCapture('/ws', 'c1', 0, 50)
  assert.ok(after.lines.length >= 1, 'history remains after disconnect')
  assert.equal(after.open, false)
  a.capture.bumpEpoch()
  a.capture.push({ direction: 'tx', hex: 'CC', byteLength: 1, connectionId: 'c1', port: 'COM3' })
  const fed = a.capture.all()
  assert.notEqual(fed[0].epoch, fed[fed.length - 1].epoch)
  await mgr.stop()
})
