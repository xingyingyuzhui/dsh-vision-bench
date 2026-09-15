import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFramePortOptions } from '../../bench-frames-model.mjs'
import { listConnectedSerialSources, listConnectionStates } from '../../bench-serial-monitor.mjs'
import { connection, fakeTransport, setupConnBench } from '../helpers/hmi-page-fixtures.mjs'

const setup = setupConnBench

test('connectionStates covers every configured RTU/TCP connection with live status', async (t) => {
  const { home, cwd } = await setup(t, [connection('c1', 'rtu', 'COM3'), connection('c2', 'rtu', 'COM5'), connection('c3')])
  const transport = fakeTransport([
    { connectionId: 'c1', state: 'connected', connectedAt: 123, epoch: 'e1', error: '' },
    { connectionId: 'c2', state: 'error', error: 'USB 拔出', connectedAt: 0, epoch: 'e2' },
  ])
  const ran = await listConnectionStates(home, cwd, { transport })
  const byId = new Map(ran.connectionStates.map((s) => [s.connectionId, s]))
  assert.equal(ran.connectionStates.length, 3, 'all configured rtu+tcp connections present')
  assert.equal(byId.get('c1').status, 'connected')
  assert.equal(byId.get('c1').endpoint, 'COM3')
  assert.equal(byId.get('c1').connectedAt, 123)
  assert.equal(byId.get('c1').connectionEpoch, 'e1')
  assert.equal(byId.get('c2').status, 'error', 'unexpected disconnect surfaces as error')
  assert.equal(byId.get('c2').error, 'USB 拔出')
  assert.equal(byId.get('c3').status, 'disconnected', 'configured but never opened')
  assert.equal(byId.get('c3').endpoint, '127.0.0.1:502')
  assert.equal(byId.get('c3').mode, 'tcp')
})

test('TCP never appears in serialSources even when connected', async (t) => {
  const { home, cwd } = await setup(t, [connection('c1', 'rtu', 'COM3'), connection('c3')])
  const transport = fakeTransport([
    { connectionId: 'c1', state: 'connected', connectedAt: 1, port: 'COM3' },
    { connectionId: 'c3', state: 'connected', connectedAt: 2, port: '127.0.0.1' },
  ])
  const ran = await listConnectedSerialSources(home, cwd, { transport })
  assert.deepEqual(
    ran.sources.map((s) => s.connectionId),
    ['c1'],
    'only the RTU connection is a serial source',
  )
})

test('sim connections report virtual connected state and are excluded from serial sources', async (t) => {
  const { home, cwd } = await setup(t, [connection('c4', 'rtu', 'COM7', { sim: true })])
  const transport = fakeTransport([{ connectionId: 'c4', state: 'connected', connectedAt: 1, port: 'COM7' }])
  const st = await listConnectionStates(home, cwd, { transport })
  assert.equal(st.connectionStates.length, 1, 'sim included as virtual connection in connectionStates')
  assert.equal(st.connectionStates[0].status, 'connected')
  assert.equal(st.connectionStates[0].simulated, true)
  const src = await listConnectedSerialSources(home, cwd, { transport })
  assert.equal(src.sources.length, 0, 'sim excluded from physical serial sources')
})

test('frames port options only offer connected RTU sources (no TCP, no sim, no open button surface)', async () => {
  const conns = [
    { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
    { id: 'c3', name: 'C3', conn: { mode: 'tcp', host: '192.168.1.50', tcpPort: 502 } },
    { id: 'c4', name: 'C4', conn: { mode: 'rtu', port: 'COM7', sim: true } },
  ]
  const opts = buildFramePortOptions(conns, [], 'proto', [
    { connectionId: 'c1', port: 'COM3', state: 'connected' },
    { connectionId: 'c3', port: '192.168.1.50', state: 'connected' },
    { connectionId: 'c4', port: 'COM7', state: 'connected' },
  ])
  assert.deepEqual(
    opts.map((o) => o.value),
    ['all', 'conn:c1'],
    'TCP + sim excluded from 串口报文 source options',
  )
})
