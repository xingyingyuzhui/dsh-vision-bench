// Task4/0.19.2: connection states are separate from serial-frame sources —
// TCP/sim never leak into 串口报文; hosts expose full connectionStates.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listConnectedSerialSources, listConnectionStates } from '../bench-serial-monitor.mjs'
import { buildFramePortOptions } from '../bench-frames-model.mjs'
import { saveWorkspace } from '../bench-store.mjs'

const cfg = (id, mode, port, extra = {}) => ({
  id, name: id, role: 'client', enabled: true,
  conn: { mode, port, host: mode === 'tcp' ? '192.168.1.50' : '', tcpPort: 502, baudrate: 9600, slave: 1, ...extra },
})

async function setup(conns) {
  const home = await mkdtemp(join(tmpdir(), 'mcs-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, { modbus: { version: 3, connections: conns, devices: [], points: [] } })
  return { home, cwd }
}

const fakeTransport = (rows) => ({
  listConnections: async () => ({ ok: true, data: { connections: rows } }),
  captureFeed: async () => ({ ok: true, data: { lines: [] } }),
  closeConnection: async () => ({ ok: true }),
})

test('connectionStates covers every configured RTU/TCP connection with live status', async () => {
  const { home, cwd } = await setup([
    cfg('c1', 'rtu', 'COM3'),
    cfg('c2', 'rtu', 'COM5'),
    cfg('c3', 'tcp', ''),
  ])
  const t = fakeTransport([
    { connectionId: 'c1', state: 'connected', connectedAt: 123, epoch: 'e1', error: '' },
    { connectionId: 'c2', state: 'error', error: 'USB 拔出', connectedAt: 0, epoch: 'e2' },
  ])
  const ran = await listConnectionStates(home, cwd, { transport: t })
  const byId = new Map(ran.connectionStates.map((s) => [s.connectionId, s]))
  assert.equal(ran.connectionStates.length, 3, 'all configured rtu+tcp connections present')
  assert.equal(byId.get('c1').status, 'connected')
  assert.equal(byId.get('c1').endpoint, 'COM3')
  assert.equal(byId.get('c1').connectedAt, 123)
  assert.equal(byId.get('c1').connectionEpoch, 'e1')
  assert.equal(byId.get('c2').status, 'error', 'unexpected disconnect surfaces as error')
  assert.equal(byId.get('c2').error, 'USB 拔出')
  assert.equal(byId.get('c3').status, 'disconnected', 'configured but never opened')
  assert.equal(byId.get('c3').endpoint, '192.168.1.50:502')
  assert.equal(byId.get('c3').mode, 'tcp')
  await rm(home, { recursive: true, force: true })
})

test('TCP never appears in serialSources even when connected', async () => {
  const { home, cwd } = await setup([cfg('c1', 'rtu', 'COM3'), cfg('c3', 'tcp', '')])
  const t = fakeTransport([
    { connectionId: 'c1', state: 'connected', connectedAt: 1, port: 'COM3' },
    { connectionId: 'c3', state: 'connected', connectedAt: 2, port: '192.168.1.50' },
  ])
  const ran = await listConnectedSerialSources(home, cwd, { transport: t })
  assert.deepEqual(ran.sources.map((s) => s.connectionId), ['c1'], 'only the RTU connection is a serial source')
  await rm(home, { recursive: true, force: true })
})

test('sim connections are excluded from both states and sources', async () => {
  const { home, cwd } = await setup([cfg('c4', 'rtu', 'COM7', { sim: true })])
  const t = fakeTransport([{ connectionId: 'c4', state: 'connected', connectedAt: 1, port: 'COM7' }])
  const st = await listConnectionStates(home, cwd, { transport: t })
  assert.equal(st.connectionStates.length, 0, 'sim excluded from connectionStates')
  const src = await listConnectedSerialSources(home, cwd, { transport: t })
  assert.equal(src.sources.length, 0)
  await rm(home, { recursive: true, force: true })
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
  assert.deepEqual(opts.map((o) => o.value), ['all', 'conn:c1'], 'TCP + sim excluded from 串口报文 source options')
})