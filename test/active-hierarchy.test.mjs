import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeModbus } from '../bench-devices.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { mutateConfig } from '../src/application/config/config-mutation-service.mjs'
import { validateWorkspaceConfig } from '../src/application/config/config-validation-service.mjs'
import { createHmiConnectionActions } from '../src/ui/hmi/hmi-connection-actions.mjs'
import { createHmiCoreActions } from '../src/ui/hmi/hmi-core-actions.mjs'

const invariant = (pack) => {
  if (!pack.activeDeviceId) return true
  const device = (pack.devices || []).find((item) => item.id === pack.activeDeviceId)
  return !!(device && device.connectionId === pack.activeConnectionId)
}

test('活动连接没有设备时不得回退到其他连接的设备', () => {
  const pack = normalizeModbus({
    version: 3,
    connections: [
      { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
      { id: 'c3', name: 'C3', conn: { mode: 'tcp', host: '10.0.0.3', sim: true } },
    ],
    devices: [{ id: 'd3', connectionId: 'c3', name: 'D3', unitId: 1 }],
    points: [],
    activeConnectionId: 'c2',
    activeDeviceId: 'd3',
  })
  assert.equal(pack.activeConnectionId, 'c2')
  assert.equal(pack.activeDeviceId, '')
  assert.ok(invariant(pack))
})

test('输入的 activeDeviceId 属于其他连接时必须修正', () => {
  const pack = normalizeModbus({
    version: 3,
    connections: [
      { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } },
      { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
    ],
    devices: [
      { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
      { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
    ],
    points: [],
    activeConnectionId: 'c1',
    activeDeviceId: 'd2',
  })
  assert.equal(pack.activeConnectionId, 'c1')
  assert.equal(pack.activeDeviceId, 'd1')
  assert.ok(invariant(pack))
})

test('validateWorkspaceConfig 拒绝明确的跨连接活动设备', () => {
  const errors = validateWorkspaceConfig({
    modbus: {
      connections: [
        { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } },
        { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [],
      activeConnectionId: 'c1',
      activeDeviceId: 'd2',
    },
  })
  assert.ok(errors.some((item) => /活动设备/.test(item)))
})

function uiHarness(pack, extras = {}) {
  let workspace = { modbus: structuredClone(pack) }
  const workspaceRef = { current: workspace }
  const inflight = { current: 0 }
  const ctx = {
    t: (key) => key,
    post: async () => ({ ok: true }),
    cwd: '/tmp/ws',
    props: {},
    agentBridge: {},
    commandClient: {
      mutateConfig: async () => ({ ok: true, workspace: { modbus: workspace.modbus }, nextConfigVersion: 2 }),
      persistRuntime: async (patch) => {
        workspace = {
          ...workspace,
          modbus: { ...workspace.modbus, ...patch },
        }
        workspaceRef.current = workspace
        return { ok: true, workspace }
      },
      refresh: async () => ({ ok: true, workspace }),
    },
    setError() {},
    setPorts() {},
    setScanning() {},
    ioRuntime: {},
    setWorkspace(updater) {
      workspace = typeof updater === 'function' ? updater(workspace) : updater
    },
    setJournal() {},
    workspaceRef,
    inflight,
    focusState: null,
    agentCopied: '',
    setAgentCopied() {},
    setTempWatchNote() {},
    setFrameFilter() {},
    setDevForm() {},
    devForm: { open: false, id: '', name: '', unitId: 1 },
    setDevDeleteId() {},
    connForm: {},
    setConnForm() {},
    setHmiTab() {},
    setMoreOpen() {},
    pendingDeleteId: extras.pendingDeleteId || '',
    setPendingDeleteId() {},
    lastDeviceByConn: { current: {} },
  }
  const core = createHmiCoreActions(ctx)
  const connections = createHmiConnectionActions(ctx, core)
  return {
    connections,
    workspaceRef,
    get workspace() {
      return workspace
    },
  }
}

test('删除活动设备后优先选择当前连接下的其他设备', () => {
  const h = uiHarness({
    version: 3,
    configVersion: 1,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } }],
    devices: [
      { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
      { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 },
    ],
    points: [],
    values: [],
    pollingByConnection: {},
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  })
  h.connections.confirmDeleteDevice({ id: 'd1', connectionId: 'c1' })
  assert.equal(h.workspaceRef.current.modbus.activeDeviceId, 'd2')
  assert.ok(invariant(h.workspaceRef.current.modbus))
})

test('删除活动设备且当前连接没有设备时置空', () => {
  const h = uiHarness({
    version: 3,
    configVersion: 1,
    connections: [
      { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } },
      { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
    ],
    devices: [
      { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
      { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
    ],
    points: [],
    values: [],
    pollingByConnection: {},
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  })
  h.connections.confirmDeleteDevice({ id: 'd1', connectionId: 'c1' })
  assert.equal(h.workspaceRef.current.modbus.activeConnectionId, 'c1')
  assert.equal(h.workspaceRef.current.modbus.activeDeviceId, '')
  assert.ok(invariant(h.workspaceRef.current.modbus))
})

test('删除活动连接后只允许选择下一连接所属设备', () => {
  const h = uiHarness(
    {
      version: 3,
      configVersion: 1,
      connections: [
        { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } },
        { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
      ],
      devices: [{ id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }],
      points: [],
      values: [],
      pollingByConnection: {},
      framesByConnection: {},
      activeConnectionId: 'c1',
      activeDeviceId: '',
    },
    { pendingDeleteId: 'c1' },
  )
  h.connections.requestDeleteConnection('c1')
  assert.equal(h.workspaceRef.current.modbus.activeConnectionId, 'c2')
  assert.equal(h.workspaceRef.current.modbus.activeDeviceId, 'd2')
  assert.ok(invariant(h.workspaceRef.current.modbus))
})

test('删除活动连接且下一连接没有设备时置空', () => {
  const h = uiHarness(
    {
      version: 3,
      configVersion: 1,
      connections: [
        { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } },
        { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
      values: [],
      pollingByConnection: {},
      framesByConnection: {},
      activeConnectionId: 'c1',
      activeDeviceId: 'd1',
    },
    { pendingDeleteId: 'c1' },
  )
  h.connections.requestDeleteConnection('c1')
  assert.equal(h.workspaceRef.current.modbus.activeConnectionId, 'c2')
  assert.equal(h.workspaceRef.current.modbus.activeDeviceId, '')
  assert.ok(invariant(h.workspaceRef.current.modbus))
})

test('Agent 删除设备与 UI 删除设备得到相同的活动设备结果', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ah-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  const seed = {
    version: 3,
    connections: [
      { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '10.0.0.1', sim: true } },
      { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } },
    ],
    devices: [
      { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
      { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 },
      { id: 'd3', connectionId: 'c2', name: 'D3', unitId: 1 },
    ],
    points: [],
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
  try {
    saveWorkspace(home, cwd, { modbus: seed })
    const ws = loadWorkspace(home, cwd)
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: ws.modbus.configVersion,
      operation: 'device.remove',
      target: { connectionId: 'c1', deviceId: 'd1' },
      value: {},
    })
    assert.equal(ran.ok, true)
    const afterAgent = loadWorkspace(home, cwd).modbus
    assert.equal(afterAgent.activeDeviceId, 'd2')
    assert.ok(invariant(afterAgent))

    const h = uiHarness(seed)
    h.connections.confirmDeleteDevice({ id: 'd1', connectionId: 'c1' })
    assert.equal(h.workspaceRef.current.modbus.activeDeviceId, afterAgent.activeDeviceId)
    assert.ok(invariant(h.workspaceRef.current.modbus))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
