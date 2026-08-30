import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConfigMutationPlan,
  buildRuntimePatch,
  persistHmiPatch,
} from '../../src/ui/hmi/hmi-config-persistence.mjs'

const base = {
  version: 3,
  configVersion: 4,
  connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
  devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
  points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'P1', function: 3, address: 0 }],
  pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } },
  framesByConnection: { c1: [] },
  activeConnectionId: 'c1',
  activeDeviceId: 'd1',
}

test('connection create/update/remove emit matching config commands', () => {
  const created = buildConfigMutationPlan(base, {
    connections: [...base.connections, { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } }],
  })
  assert.deepEqual(
    created.map((item) => item.operation),
    ['connection.create'],
  )
  assert.equal(created[0].target.connectionId, 'c2')

  const updated = buildConfigMutationPlan(base, {
    connections: [{ ...base.connections[0], name: 'C1b' }],
  })
  assert.equal(updated[0].operation, 'connection.update')
  assert.equal(updated[0].target.connectionId, 'c1')

  const removed = buildConfigMutationPlan(base, { connections: [] })
  assert.deepEqual(
    removed.map((item) => item.operation),
    ['connection.remove'],
  )
  assert.equal(removed[0].target.connectionId, 'c1')
})

test('device create/update/remove emit matching config commands', () => {
  const created = buildConfigMutationPlan(base, {
    devices: [...base.devices, { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 }],
  })
  assert.equal(created[0].operation, 'device.create')
  assert.equal(created[0].target.deviceId, 'd2')

  const updated = buildConfigMutationPlan(base, {
    devices: [{ ...base.devices[0], name: 'D1b' }],
  })
  assert.equal(updated[0].operation, 'device.update')

  const removed = buildConfigMutationPlan(base, { devices: [] })
  assert.deepEqual(
    removed.map((item) => item.operation),
    ['device.remove'],
  )
  assert.equal(removed[0].target.deviceId, 'd1')
})

test('point add/update/remove emit matching config commands', () => {
  const added = buildConfigMutationPlan(base, {
    points: [...base.points, { id: 'p2', connectionId: 'c1', deviceId: 'd1', name: 'P2', function: 3, address: 1 }],
  })
  assert.equal(added[0].operation, 'points.add')
  assert.equal(added[0].value.points[0].id, 'p2')

  const updated = buildConfigMutationPlan(base, {
    points: [{ ...base.points[0], name: 'P1b' }],
  })
  assert.equal(updated[0].operation, 'points.update')
  assert.equal(updated[0].value.points[0].id, 'p1')

  const removed = buildConfigMutationPlan(base, { points: [] })
  assert.equal(removed[0].operation, 'points.remove')
  assert.deepEqual(removed[0].value.ids, ['p1'])
})

test('deleting a connection does not also emit device/point removes', () => {
  const ops = buildConfigMutationPlan(base, {
    connections: [],
    devices: [],
    points: [],
  })
  assert.deepEqual(
    ops.map((item) => item.operation),
    ['connection.remove'],
  )
})

test('deleting a device does not also emit point removes', () => {
  const ops = buildConfigMutationPlan(base, {
    devices: [],
    points: [],
  })
  assert.deepEqual(
    ops.map((item) => item.operation),
    ['device.remove'],
  )
})

test('persistHmiPatch runs commands serially and forwards configVersion', async () => {
  const seen = []
  let version = 4
  const client = {
    async mutateConfig(operation, target, value, expected) {
      seen.push({ operation, expected })
      assert.equal(expected, version)
      version += 1
      return { ok: true, nextConfigVersion: version }
    },
    async persistRuntime() {
      throw new Error('runtime should wait until config commands finish')
    },
  }
  const ran = await persistHmiPatch(client, base, {
    connections: [...base.connections, { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.2' } }],
    devices: [...base.devices, { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 }],
  })
  assert.equal(ran.ok, true)
  assert.deepEqual(
    seen.map((item) => item.operation),
    ['connection.create', 'device.create'],
  )
  assert.deepEqual(
    seen.map((item) => item.expected),
    [4, 5],
  )
})

test('CONFIG_DRIFT stops remaining commands and skips runtime patch', async () => {
  const seen = []
  const client = {
    async mutateConfig(operation, _target, _value, expected) {
      seen.push(operation)
      if (seen.length === 1) return { ok: true, nextConfigVersion: expected + 1 }
      return { ok: false, errorCode: 'CONFIG_DRIFT', error: 'drift' }
    },
    async persistRuntime() {
      seen.push('runtime')
      return { ok: true }
    },
  }
  const ran = await persistHmiPatch(client, base, {
    connections: [{ ...base.connections[0], name: 'C1b' }],
    devices: [{ ...base.devices[0], name: 'D1b' }],
    activeConnectionId: 'c1',
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'CONFIG_DRIFT')
  assert.deepEqual(seen, ['connection.update', 'device.update'])
})

test('config failure does not submit a runtime patch', async () => {
  let runtimeCalls = 0
  const client = {
    async mutateConfig() {
      return { ok: false, errorCode: 'WORKSPACE_WRITE_FAILED', error: 'disk full' }
    },
    async persistRuntime() {
      runtimeCalls += 1
      return { ok: true }
    },
  }
  const ran = await persistHmiPatch(client, base, {
    connections: [{ ...base.connections[0], name: 'Nope' }],
    activeConnectionId: 'c1',
    pollingByConnection: { c1: { enabled: true, intervalMs: 500 } },
  })
  assert.equal(ran.ok, false)
  assert.equal(runtimeCalls, 0)
})

test('only activity/polling/frames go through runtime workspace patch', () => {
  const runtime = buildRuntimePatch(base, {
    connections: base.connections,
    devices: base.devices,
    points: base.points,
    visualization: { schemaVersion: 1, components: [] },
    values: [{ pointId: 'p1', raw: 1 }],
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
    pollingByConnection: { c1: { enabled: true, intervalMs: 250 } },
    framesByConnection: { c1: [{ id: 'f1' }] },
  })
  assert.deepEqual(Object.keys(runtime).sort(), [
    'activeConnectionId',
    'activeDeviceId',
    'framesByConnection',
    'pollingByConnection',
  ])
  assert.equal(runtime.connections, undefined)
  assert.equal(runtime.devices, undefined)
  assert.equal(runtime.points, undefined)
  assert.equal(runtime.visualization, undefined)
  assert.equal(runtime.values, undefined)
})

test('stale UI point array does not delete an Agent-added point that the snapshot never saw', () => {
  const ops = buildConfigMutationPlan(base, {
    points: [{ ...base.points[0], name: 'P1 from UI' }],
  })
  assert.equal(ops.length, 1)
  assert.equal(ops[0].operation, 'points.update')
  assert.ok(!JSON.stringify(ops).includes('points.remove'))
  assert.ok(!JSON.stringify(ops).includes('p2'))
})

test('createHmiActions still exposes persist/derived/scanPorts and button handlers', async () => {
  const { createHmiActions } = await import('../../src/ui/hmi/hmi-page-actions.mjs')
  const actions = createHmiActions({
    t: (key) => key,
    post: async () => ({}),
    cwd: '/tmp',
    props: {},
    agentBridge: {},
    commandClient: {
      mutateConfig: async () => ({ ok: true }),
      persistRuntime: async () => ({ ok: true }),
      refresh: async () => ({}),
    },
    setError() {},
    setPorts() {},
    setScanning() {},
    ioRuntime: {},
    setWorkspace() {},
    setJournal() {},
    workspaceRef: { current: { modbus: base } },
    inflight: { current: 0 },
    flagInflight: { current: 0 },
    focusState: {},
    agentCopied: '',
    setAgentCopied() {},
    setTempWatchNote() {},
    setBusy() {},
    setPending() {},
    setConnectionStates() {},
    setFrameFilter() {},
    setEditingDeviceId() {},
    setEditingPointsDeviceId() {},
    deviceDraft: null,
    setDeviceDraft() {},
    pointDraftsById: {},
    setPointDraftsById() {},
    newPointDraft: null,
    setNewPointDraft() {},
    inlineWrite: null,
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
    connForm: {},
    setConnForm() {},
    setHmiTab() {},
    setMoreOpen() {},
    pendingDeleteId: '',
    setPendingDeleteId() {},
    setLinkBusy() {},
    lastDeviceByConn: { current: {} },
    setDevForm() {},
    devForm: {},
    setDevDeleteId() {},
  })
  for (const key of [
    'scanPorts',
    'persist',
    'derived',
    'sendToAgent',
    'agentBtnLabel',
    'requestFocusUi',
    'addConnection',
    'saveDeviceForm',
    'selectConnection',
    'generateBatch',
    'persistPointFlags',
    'readAll',
    'openWriteCell',
    'linkConnection',
    'toggleCollection',
  ]) {
    assert.equal(typeof actions[key], 'function', key)
  }
  assert.equal(typeof actions.agentBtnLabel('point', { id: 'p1' }), 'string')
})
