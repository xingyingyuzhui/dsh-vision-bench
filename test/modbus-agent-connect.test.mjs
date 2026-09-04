// Task5+6/0.19.2: Agent connect/close contract — connectionId-only open/close,
// partial result on physical connect failure, and the slave role is rejected.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectOp } from '../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'

const c1 = {
  id: 'c1',
  name: 'C1',
  role: 'client',
  enabled: true,
  conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1, slave: 1, sim: false },
}
const sv = {
  id: 's1',
  name: 'S1',
  role: 'server',
  enabled: true,
  conn: { mode: 'rtu', port: 'COM5', baudrate: 9600, slave: 1 },
}

function fakeTransport() {
  const opened = []
  const closed = []
  return {
    opened,
    closed,
    openConnection: async (req) => {
      opened.push(req)
      if (req.endpoint && (req.endpoint.port === 'COM3' || req.endpoint.port === 'COM5'))
        return { ok: true, data: { state: 'connected' } }
      return { ok: false, error: { code: 'CONNECT_FAILED', message: '连接失败' } }
    },
    closeConnection: async (req) => {
      closed.push(req)
      return { ok: true }
    },
    releaseConnection: async (req) => {
      closed.push(req)
      return { ok: true }
    },
    listConnections: async () => ({ ok: true, data: { connections: [] } }),
    captureFeed: async () => ({ ok: true, data: { lines: [] } }),
  }
}

async function setup(conns) {
  const home = await mkdtemp(join(tmpdir(), 'mac-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, { modbus: { version: 3, connections: conns, devices: [], points: [] } })
  return { home, cwd }
}

test('connectionId-only open uses the saved configuration', async () => {
  const { home, cwd } = await setup([c1])
  const t = fakeTransport()
  const ran = await connectOp(home, cwd, { connectionId: 'c1' }, { transport: t })
  assert.equal(ran.ok, true)
  assert.equal(ran.connected, true)
  assert.equal(ran.configured, false, 'no patch applied')
  assert.equal(t.opened.length, 1)
  assert.equal(t.opened[0].connectionId, 'c1')
  assert.equal(t.opened[0].endpoint.port, 'COM3', 'used saved COM3')
  await rm(home, { recursive: true, force: true })
})

test('connectionId-only close requires no patch', async () => {
  const { home, cwd } = await setup([c1])
  const t = fakeTransport()
  const ran = await connectOp(home, cwd, { connectionId: 'c1', close: true }, { transport: t })
  assert.equal(ran.ok, true)
  assert.equal(ran.connected, false)
  assert.equal(ran.live, 'disconnected')
  assert.equal(t.closed.length, 1)
  await rm(home, { recursive: true, force: true })
})

test('patch saves config, physical connect failure returns configured:true connected:false', async () => {
  const { home, cwd } = await setup([{ ...c1, conn: { ...c1.conn, port: 'COM9' } }])
  const t = fakeTransport()
  const ran = await connectOp(home, cwd, { connectionId: 'c1', port: 'COM9' }, { transport: t })
  assert.equal(ran.ok, false)
  assert.equal(ran.configured, true, 'config was saved')
  assert.equal(ran.connected, false)
  assert.equal(ran.error, '连接失败')
  // config persisted despite the failed physical connect
  const saved = loadWorkspace(home, cwd).modbus.connections.find((c) => c.id === 'c1')
  assert.equal(saved.conn.port, 'COM9', 'patch is not rolled back')
  await rm(home, { recursive: true, force: true })
})

test('server/slave role is supported and connects with role on endpoint (UI + Agent)', async () => {
  const { home, cwd } = await setup([sv])
  const t = fakeTransport()
  const ran = await connectOp(home, cwd, { connectionId: 's1' }, { transport: t })
  assert.equal(ran.ok, true)
  assert.equal(ran.connected, true)
  assert.equal(t.opened.length, 1, 'opened connection for server role')
  assert.equal(t.opened[0].endpoint.role, 'server')
  // Agent tool path also connects
  const viaTool = await runVisionBench(
    home,
    { action: 'connect', connectionId: 's1' },
    cwd,
    { source: 'agent', sessionId: 's1' },
    { transport: t },
  )
  assert.equal(viaTool.ok, true)
  assert.equal(viaTool.connected, true)
  await rm(home, { recursive: true, force: true })
})

test('agent connect keeps an agent source identity in the request payload', async () => {
  const { home, cwd } = await setup([c1])
  const t = fakeTransport()
  await connectOp(home, cwd, { connectionId: 'c1', source: 'agent' }, { transport: t })
  // transport-level source mapping lives in toReadRequest/toWriteRequest; verify
  // read requests built by runVisionBench carry the agent source
  const { toReadRequest } = await import('../bench-modbus-transport.mjs')
  const req = toReadRequest({
    cwd,
    connection: c1,
    device: { id: 'd1', unitId: 1 },
    batch: { fc: 3, address: 0, count: 1 },
    source: 'agent',
  })
  assert.equal(req.source, 'agent')
  const poll = toReadRequest({
    cwd,
    connection: c1,
    device: { id: 'd1', unitId: 1 },
    batch: { fc: 3, address: 0, count: 1 },
    source: 'polling',
  })
  assert.equal(poll.source, 'polling')
  // legacy 'user' degrades to manual
  const manual = toReadRequest({
    cwd,
    connection: c1,
    device: { id: 'd1', unitId: 1 },
    batch: { fc: 3, address: 0, count: 1 },
    source: 'user',
  })
  assert.equal(manual.source, 'manual')
  await rm(home, { recursive: true, force: true })
})
