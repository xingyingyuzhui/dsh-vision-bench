import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_FRAME_HEX_CHARS,
  MAX_FRAMES_PER_CONN,
  normalizeFramesByConnection,
} from '../../src/domain/modbus/frames-buffer.mjs'
import {
  buildFramePortOptions,
  projectTransactionsToWireFrames,
  projectTransactionToWireFrames,
} from '../../src/domain/modbus/frames-model.mjs'
import { framePayloadHex } from '../../src/ui/monitor/frames/frames-format.mjs'

test('projectTransactionToWireFrames emits tx+rx sharing transactionId', () => {
  const rows = projectTransactionToWireFrames({
    id: 't1',
    transactionId: 't1',
    request: '0103',
    response: '010304',
    requestHex: '0103',
    responseHex: '010304ABCD',
    direction: 'tx',
    status: 'ok',
    connectionId: 'c1',
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].direction, 'tx')
  assert.equal(rows[0].id, 't1:tx')
  assert.equal(rows[0].transactionId, 't1')
  assert.equal(rows[1].direction, 'rx')
  assert.equal(rows[1].id, 't1:rx')
  assert.equal(rows[1].transactionId, 't1')
  assert.equal(framePayloadHex(rows[0]), '0103')
  assert.equal(framePayloadHex(rows[1]), '010304ABCD')
})

test('projectTransactionToWireFrames keeps tx-only when response empty', () => {
  const rows = projectTransactionToWireFrames({
    id: 't2',
    transactionId: 't2',
    requestHex: 'AABB',
    responseHex: '',
    direction: 'tx',
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].direction, 'tx')
})

test('projectTransactionsToWireFrames flattens a list', () => {
  const out = projectTransactionsToWireFrames([
    { id: 'a', transactionId: 'a', requestHex: '01', responseHex: '02' },
    { id: 'b', transactionId: 'b', requestHex: '03', responseHex: '' },
  ])
  assert.equal(out.length, 3)
  assert.deepEqual(
    out.map((r) => r.id),
    ['a:tx', 'a:rx', 'b:tx'],
  )
})

test('normalizeFramesByConnection keeps newest MAX frames', () => {
  const input = {
    c1: Array.from({ length: 600 }, (_, i) => ({
      id: `f${i}`,
      t: i + 1,
      request: `r${i}`,
      response: '',
    })),
  }
  const out = normalizeFramesByConnection(input)
  assert.equal(out.c1.length, MAX_FRAMES_PER_CONN)
  assert.equal(out.c1[0].id, 'f100')
  assert.equal(out.c1[out.c1.length - 1].id, 'f599')
})

test('normalizeFramesByConnection preserves long hex (authority field)', () => {
  const hex = 'AB'.repeat(300) // 600 hex chars
  const out = normalizeFramesByConnection({
    c1: [{ id: 'x', t: 1, requestHex: hex, responseHex: hex, request: 'short', response: 'short' }],
  })
  assert.ok(out.c1[0].requestHex.length >= 520)
  assert.ok(out.c1[0].requestHex.length <= MAX_FRAME_HEX_CHARS)
  assert.equal(out.c1[0].requestHex, hex.toUpperCase().slice(0, MAX_FRAME_HEX_CHARS))
})

test('buildFramePortOptions proto lists all configured connections', () => {
  const connections = [
    { id: 'c1', name: 'RTU', conn: { mode: 'rtu', port: 'COM3' }, enabled: true },
    { id: 'c2', name: 'TCP', conn: { mode: 'tcp', host: '1.2.3.4', port: 502 }, enabled: true },
    { id: 'c3', name: 'SIM', conn: { mode: 'rtu', port: 'COM9', sim: true }, enabled: true },
    { id: 'c4', name: 'Off', conn: { mode: 'rtu', port: 'COM1' }, enabled: false },
  ]
  const live = [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'RTU' }]
  const proto = buildFramePortOptions(connections, [], 'proto', live)
  const values = proto.map((o) => o.value)
  assert.ok(values.includes('all'))
  assert.ok(values.includes('conn:c1'))
  assert.ok(values.includes('conn:c2'))
  assert.ok(values.includes('conn:c3'))
  assert.ok(values.includes('conn:c4'))
  const raw = buildFramePortOptions(connections, [], 'raw', live)
  const rawValues = raw.map((o) => o.value)
  assert.deepEqual(rawValues, ['all', 'conn:c1'])
})
