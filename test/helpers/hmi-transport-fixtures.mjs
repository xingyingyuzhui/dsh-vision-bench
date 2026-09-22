// @ts-check
/** Connection / live / flag harness fixtures for HMI tests (P4-1). */
import { createHmiLiveActions } from '../../src/ui/hmi/hmi-live-actions.mjs'
import { createHmiPointActions } from '../../src/ui/hmi/hmi-point-actions.mjs'
import { connection, createBench } from './workspace-factory.mjs'

/** Connection-state workspace setup. */
export const setupConnBench = (tCtx, conns) => createBench(tCtx, { prefix: 'mcs-', shared: { connections: conns } })

export const fakeTransport = (rows) => ({
  listConnections: async () => ({ ok: true, data: { connections: rows } }),
  captureFeed: async () => ({ ok: true, data: { lines: [] } }),
  closeConnection: async () => ({ ok: true }),
})

/** Live actions harness for unlink/link/polling failure tests. */
export function liveHarness(opts = {}) {
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

/** Point-actions harness for flags persist / rollback tests. */
export function flagHarness(opts = {}) {
  const pack = {
    version: 3,
    configVersion: 10,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
    devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    points: [
      {
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        monitorEnabled: false,
        alarmEnabled: false,
        trendEnabled: false,
        alarmMin: 1,
        alarmMax: 9,
      },
    ],
    values: [],
    pollingByConnection: {},
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
  let workspace = { modbus: structuredClone(pack), ...(opts.session ? { session: opts.session } : {}) }
  const workspaceRef = { current: workspace }
  const flagPatches = []
  const errors = []
  const ctx = {
    t: (key) => key,
    post: opts.post,
    cwd: '/tmp/ws',
    sessionId: opts.sessionId,
    commandClient: {
      refresh:
        opts.refresh ||
        (async () => {
          throw new Error('no refresh')
        }),
    },
    setError(msg) {
      errors.push(msg || '')
    },
    setWorkspace(updater) {
      const prev = workspace
      workspace = typeof updater === 'function' ? updater(workspace) : updater
      const before = prev.modbus.points.find((p) => p.id === 'p1')
      const after = workspace.modbus.points.find((p) => p.id === 'p1')
      if (before && after) {
        const patch = {}
        for (const key of ['monitorEnabled', 'trendEnabled', 'alarmEnabled']) {
          if (before[key] !== after[key]) patch[key] = after[key]
        }
        if (Object.keys(patch).length) flagPatches.push(patch)
      }
    },
    workspaceRef,
    flagInflight: { current: 0 },
    setEditingDeviceId() {},
    setEditingPointsDeviceId() {},
    deviceDraft: null,
    setDeviceDraft() {},
    pointDraftsById: {},
    setPointDraftsById() {},
    newPointDraft: null,
    setNewPointDraft() {},
    setInlineWrite() {},
    batch: {},
    setBatch() {},
    csvText: '',
    setCsvText() {},
    csvTarget: {},
    setCsvTarget() {},
    setCsvNote() {},
    setFlagSavingByPoint() {},
    flagRequestSeq: { current: {} },
  }
  const core = {
    normalizePack() {
      return workspaceRef.current.modbus
    },
    persist() {},
    activeConnIdOf() {
      return 'c1'
    },
  }
  return {
    actions: createHmiPointActions(ctx, core),
    flagPatches,
    errors,
    get error() {
      return errors[errors.length - 1] || ''
    },
    get point() {
      return workspace.modbus.points[0]
    },
    workspaceRef,
  }
}

export { connection }
