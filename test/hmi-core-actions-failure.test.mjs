import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmiCoreActions } from '../src/ui/hmi/hmi-core-actions.mjs'

const basePack = () => ({
  version: 3,
  configVersion: 4,
  connections: [
    { id: 'c1', name: 'old', role: 'client', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', sim: true } },
  ],
  devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
  points: [],
  values: [],
  pollingByConnection: {},
  framesByConnection: {},
  activeConnectionId: 'c1',
  activeDeviceId: 'd1',
})

function harness(opts = {}) {
  const initial = basePack()
  let error = ''
  let journal = null
  let workspace = { modbus: structuredClone(initial) }
  const workspaceRef = { current: workspace }
  const inflight = { current: 0 }
  let refreshCalls = 0
  const commandClient = {
    mutateConfig:
      opts.mutateConfig ||
      (async () => ({
        ok: true,
        workspace: { modbus: workspace.modbus },
        nextConfigVersion: 5,
      })),
    persistRuntime: opts.persistRuntime || (async () => ({ ok: true, workspace: { modbus: workspace.modbus } })),
    refresh:
      opts.refresh ||
      (async () => {
        refreshCalls += 1
        return {
          ok: true,
          workspace: { modbus: structuredClone(initial) },
          journal: { tasks: [], running: [], timeline: [] },
        }
      }),
  }
  const ctx = {
    t: (key) => key,
    post: async () => ({ ok: true }),
    cwd: '/tmp/ws',
    props: {},
    agentBridge: {},
    commandClient,
    setError(value) {
      error = String(value || '')
    },
    setPorts() {},
    setScanning() {},
    ioRuntime: {},
    setWorkspace(updater) {
      workspace = typeof updater === 'function' ? updater(workspace) : updater
    },
    setJournal(value) {
      journal = value
    },
    workspaceRef,
    inflight,
    focusState: null,
    agentCopied: '',
    setAgentCopied() {},
    setTempWatchNote() {},
  }
  const core = createHmiCoreActions(ctx)
  return {
    core,
    initial,
    get error() {
      return error
    },
    get workspace() {
      return workspace
    },
    get journal() {
      return journal
    },
    get refreshCalls() {
      return refreshCalls
    },
    bumpRefresh() {
      refreshCalls += 1
    },
    workspaceRef,
    inflight,
    commandClient,
  }
}

const renamePatch = (name) => ({
  connections: [{ id: 'c1', name, role: 'client', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
  version: 3,
})

test('配置命令抛出异常后回滚乐观状态并刷新 Host', async () => {
  const h = harness({
    mutateConfig: async () => {
      throw new Error('offline')
    },
  })
  await h.core.persist(renamePatch('optimistic'))
  assert.notEqual(h.workspace.modbus.connections[0].name, 'optimistic')
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'old')
  assert.ok(h.error, '页面显示明确错误')
  assert.ok(h.refreshCalls >= 1, '必须尝试 refresh()')
})

test('CONFIG_DRIFT 刷新 Host 后不保留乐观修改', async () => {
  const h = harness({
    mutateConfig: async () => ({ ok: false, errorCode: 'CONFIG_DRIFT', error: 'drift' }),
  })
  await h.core.persist(renamePatch('optimistic'))
  assert.equal(h.workspace.modbus.connections[0].name, 'old')
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'old')
  assert.ok(h.refreshCalls >= 1)
  assert.match(h.error, /drift|fail|失败/i)
})

test('WORKSPACE_WRITE_FAILED 刷新 Host 后不保留乐观修改', async () => {
  const h = harness({
    mutateConfig: async () => ({ ok: false, errorCode: 'WORKSPACE_WRITE_FAILED', error: 'write failed' }),
  })
  await h.core.persist(renamePatch('optimistic'))
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'old')
  assert.ok(h.refreshCalls >= 1)
})

test('CONFIG_INVALID 刷新 Host 后不保留乐观修改', async () => {
  const h = harness({
    mutateConfig: async () => ({ ok: false, errorCode: 'CONFIG_INVALID', error: 'invalid' }),
  })
  await h.core.persist(renamePatch('optimistic'))
  assert.equal(h.workspace.modbus.connections[0].name, 'old')
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'old')
  assert.ok(h.refreshCalls >= 1)
})

test('刷新本身也失败时回退修改前快照', async () => {
  const h = harness({
    mutateConfig: async () => {
      throw new Error('offline')
    },
    refresh: async () => {
      throw new Error('refresh down')
    },
  })
  await h.core.persist(renamePatch('optimistic'))
  assert.equal(h.workspace.modbus.connections[0].name, 'old')
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'old')
  assert.equal(h.error, '配置保存失败，当前状态可能已过期')
  await h.core.persist(renamePatch('second'))
  assert.notEqual(h.workspaceRef.current.modbus.connections[0].name, 'second')
})

test('旧请求晚到不能覆盖已确认的新请求', async () => {
  let releaseFirst
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })
  let calls = 0
  const h = harness({
    mutateConfig: async (_op, _target, value) => {
      calls += 1
      if (calls === 1) {
        await firstGate
        throw new Error('late fail')
      }
      return {
        ok: true,
        workspace: {
          modbus: {
            ...basePack(),
            configVersion: 6,
            connections: [
              {
                id: 'c1',
                name: value.name,
                role: 'client',
                enabled: true,
                conn: { mode: 'tcp', host: '127.0.0.1', sim: true },
              },
            ],
          },
        },
        nextConfigVersion: 6,
      }
    },
  })
  const first = h.core.persist(renamePatch('first'))
  const second = h.core.persist(renamePatch('second'))
  await second
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'second')
  releaseFirst()
  await first
  assert.equal(h.workspaceRef.current.modbus.connections[0].name, 'second')
  assert.notEqual(h.workspaceRef.current.modbus.connections[0].name, 'old')
})
