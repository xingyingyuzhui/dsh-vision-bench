// Task4/0.19.2: connection states are separate from serial-frame sources —
// TCP/sim never leak into 串口报文; hosts expose full connectionStates.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildFramePortOptions } from '../bench-frames-model.mjs'
import { listConnectedSerialSources, listConnectionStates } from '../bench-serial-monitor.mjs'
import { saveWorkspace } from '../bench-store.mjs'
import { createHmiLiveActions } from '../src/ui/hmi/hmi-live-actions.mjs'

const cfg = (id, mode, port, extra = {}) => ({
  id,
  name: id,
  role: 'client',
  enabled: true,
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
  const { home, cwd } = await setup([cfg('c1', 'rtu', 'COM3'), cfg('c2', 'rtu', 'COM5'), cfg('c3', 'tcp', '')])
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
  assert.deepEqual(
    ran.sources.map((s) => s.connectionId),
    ['c1'],
    'only the RTU connection is a serial source',
  )
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

function liveHarness(opts = {}) {
  const pack = {
    version: 3,
    configVersion: 1,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: false } }],
    devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    points: [],
    values: [],
    pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } },
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
  let workspace = { modbus: structuredClone(pack) }
  const workspaceRef = { current: workspace }
  let error = ''
  let linkBusy = ''
  let connectionStates = [{ connectionId: 'c1', status: 'connected' }]
  const posts = []
  const post =
    opts.post ||
    (async (path, body) => {
      posts.push({ path, body })
      throw new Error('missing post')
    })
  const ctx = {
    t: (key) => (key === 'fail' ? '失败' : key),
    post,
    cwd: '/tmp/ws',
    sessionId: 's1',
    setBusy() {},
    setError(value) {
      error = String(value || '')
    },
    setWorkspace(updater) {
      workspace = typeof updater === 'function' ? updater(workspace) : updater
    },
    setJournal() {},
    setConnectionStates(value) {
      connectionStates = value
    },
    workspaceRef,
    setNewPointDraft() {},
    inlineWrite: null,
    setInlineWrite() {},
    setLinkBusy(value) {
      linkBusy = value
    },
  }
  const core = {
    normalizePack() {
      return workspaceRef.current.modbus
    },
    persist: opts.persist || (async () => ({ ok: true })),
    derived() {
      const polling = workspace.modbus.pollingByConnection.c1
      return {
        activeConnId: 'c1',
        sim: false,
        watchEnabled: !!polling.enabled,
        polling,
        pollingByConnection: workspace.modbus.pollingByConnection,
        connections: workspace.modbus.connections,
      }
    },
  }
  return {
    actions: createHmiLiveActions(ctx, core),
    posts,
    get error() {
      return error
    },
    get linkBusy() {
      return linkBusy
    },
    get connectionStates() {
      return connectionStates
    },
    get workspace() {
      return workspace
    },
  }
}

test('断开连接抛出异常时显示错误并清除 busy，不伪装已断开', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') throw new Error('close exploded')
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /close exploded|失败/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.connectionStates[0].status, 'connected')
})

test('断开连接返回 ok:false 时显示错误并刷新真实状态', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') return { ok: false, error: 'port busy' }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /port busy/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.connectionStates[0].status, 'connected')
})

test('关闭连接后 /state 刷新失败仍有错误提示并清除 busy', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') return { ok: true }
      if (path === '/dsh-vision-bench/state') throw new Error('state down')
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(h.error)
  assert.equal(h.linkBusy, '')
})

test('采集启动抛出异常时显示错误且不伪装已开始采集', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/polling/start') throw new Error('poll exploded')
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.toggleCollection())
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /poll exploded|失败/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
})

test('采集启动返回 ok:false 时显示错误', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/polling/start') return { ok: false, error: 'already running' }
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.toggleCollection())
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /already running/)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
})

test('修改采集间隔失败时保留原间隔并显示错误', async () => {
  const posts = []
  const h = liveHarness({
    post: async (path, body) => {
      posts.push({ path, body })
      if (path === '/dsh-vision-bench/polling/start') return { ok: false, error: 'interval denied' }
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.setPollingInterval(2000))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /interval denied/)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.intervalMs, 1000)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
  assert.ok(posts.some((item) => item.path === '/dsh-vision-bench/polling/start'))
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
