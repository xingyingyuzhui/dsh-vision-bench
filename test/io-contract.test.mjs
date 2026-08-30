import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IO_MAX_LINE,
  decodeNdjsonLine,
  endpointFingerprint,
  toEndpoint,
  validateIoRequest,
} from '../bench-io-contract.mjs'

test('validateIoRequest rejects unknown version, op and missing target', async () => {
  assert.equal(validateIoRequest(null).ok, false)
  assert.equal(validateIoRequest({ v: 2, id: 'a', op: 'health' }).ok, false)
  assert.equal(validateIoRequest({ v: 1, id: 'a', op: 'nope' }).ok, false)
  assert.equal(validateIoRequest({ v: 1, id: 'a', op: 'modbus.read' }).ok, false)
})

test('validateIoRequest rejects unit 0, bad FC and oversize counts', async () => {
  const base = {
    v: 1,
    id: 'r1',
    op: 'modbus.read',
    cwd: '/tmp/ws',
    connectionId: 'c1',
    deviceId: 'd1',
    endpoint: { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 },
    functionCode: 3,
    address: 0,
    count: 1,
  }
  assert.equal(validateIoRequest({ ...base, unitId: 0 }).ok, false)
  assert.equal(validateIoRequest({ ...base, unitId: 1 }).ok, true)
  assert.equal(validateIoRequest({ ...base, unitId: 1, count: 126 }).ok, false)
  assert.equal(validateIoRequest({ ...base, unitId: 1, functionCode: 1, count: 2000 }).ok, true)
  assert.equal(validateIoRequest({ ...base, unitId: 1, address: 65535, count: 2 }).ok, false)
})

test('endpoint fingerprint includes RTU framing fields and excludes unitId', async () => {
  const a = toEndpoint({ conn: { mode: 'rtu', port: 'com3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 } })
  const b = toEndpoint({
    conn: { mode: 'rtu', port: '\\\\.\\COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1 },
  })
  const c = toEndpoint({ conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 7, parity: 'N', stopbits: 1 } })
  assert.equal(endpointFingerprint(a), endpointFingerprint(b))
  assert.notEqual(endpointFingerprint(a), endpointFingerprint(c))
  const tcp = toEndpoint({ conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 1502 } })
  assert.match(endpointFingerprint(tcp), /^tcp\|/)
})

test('decodeNdjsonLine rejects oversize and bad json', async () => {
  assert.equal(decodeNdjsonLine('{').ok, false)
  assert.equal(decodeNdjsonLine(JSON.stringify({ v: 1 })).ok, true)
  assert.equal(decodeNdjsonLine('x'.repeat(IO_MAX_LINE + 1)).ok, false)
})

test('connection and capture ops validate without opening a second port', async () => {
  assert.equal(validateIoRequest({ v: 1, id: 's1', op: 'connection.status', cwd: '/tmp/ws' }).ok, true)
  assert.equal(validateIoRequest({ v: 1, id: 'f1', op: 'serial.capture.feed', cwd: '/tmp/ws' }).ok, true)
  assert.equal(
    validateIoRequest({ v: 1, id: 'c1', op: 'connection.close', cwd: '/tmp/ws', connectionId: 'c1' }).ok,
    true,
  )
  assert.equal(
    validateIoRequest({ v: 1, id: 'o1', op: 'connection.open', cwd: '/tmp/ws', connectionId: 'c1' }).ok,
    false,
  )
  assert.equal(
    validateIoRequest({
      v: 1,
      id: 'o2',
      op: 'connection.open',
      cwd: '/tmp/ws',
      connectionId: 'c1',
      endpoint: { mode: 'rtu', port: 'COM3' },
    }).ok,
    true,
  )
  assert.equal(
    validateIoRequest({ v: 1, id: 'x', op: 'serial.monitor.open', cwd: '/tmp/ws', connectionId: 'raw' }).ok,
    false,
  )
})
