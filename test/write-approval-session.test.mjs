import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listPendingWrites, peekPendingWrite, resolvePendingWrite, takePendingWrite } from '../bench-actions.mjs'
import { journalView, loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { saveSessionModbusPatch } from '../src/application/modbus/workspace-session-view.mjs'
import { ERROR_CODES } from '../src/domain/modbus/errors.mjs'
import { createVisionRpcRouter } from '../src/interfaces/rpc/vision-rpc-router.mjs'

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'

function boardTopology() {
  const connections = [
    { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } },
  ]
  const devices = [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }]
  const points = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    name: 'HR' + i,
    connectionId: 'c1',
    deviceId: 'd1',
    area: 'holdingRegister',
    function: 3,
    address: i,
  }))
  return { connections, devices, points, activeConnectionId: 'c1', activeDeviceId: 'd1' }
}

async function setupBoard(prefix) {
  const home = await mkdtemp(join(tmpdir(), prefix))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const topo = boardTopology()
  // Pre-partition so A and B each have a private copy; avoids "first opener claims all".
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      privateClaimSessionId: SESSION_A,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [SESSION_A]: { ...topo },
        [SESSION_B]: { ...topo, points: topo.points.map((p) => ({ ...p })) },
      },
    },
  })
  return { home, cwd }
}

async function raisePendingWrite(home, cwd, sessionId, address, value) {
  const ran = await runVisionBench(home, { action: 'write', function: 3, address, values: [value] }, cwd, {
    source: 'agent',
    sessionId,
  })
  assert.equal(ran.needsConfirm, true)
  assert.ok(ran.requestId)
  return ran.requestId
}

function writtenValues(home, cwd) {
  return (loadWorkspace(home, cwd).modbus.values || []).filter((rec) => rec.value !== null && rec.value !== undefined)
}

function timelineKinds(home, cwd) {
  return (loadWorkspace(home, cwd).timeline || []).map((item) => item.kind)
}

test('owner session can approve its own pending write', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-own-approve-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 1, 11)
    const ran = await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_A })
    assert.equal(ran.ok, true)
    assert.deepEqual(ran.readback, [11])
    const task = journalView(loadWorkspace(home, cwd)).tasks.find((item) => item.type === 'write')
    assert.equal(task.sessionId, SESSION_A)
    assert.equal(peekPendingWrite(cwd, id), null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('owner session can reject its own pending write', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-own-reject-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 2, 22)
    const ran = await resolvePendingWrite(home, cwd, id, false, { sessionId: SESSION_A })
    assert.equal(ran.ok, true)
    assert.equal(ran.rejected, true)
    assert.equal(writtenValues(home, cwd).length, 0)
    assert.ok(timelineKinds(home, cwd).includes('write-reject'))
    assert.equal(peekPendingWrite(cwd, id), null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('foreign session cannot approve: SESSION_MISMATCH, request survives, device untouched, no logs', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-foreign-approve-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 3, 33)
    const ran = await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_B })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, ERROR_CODES.SESSION_MISMATCH)
    assert.equal(ran.error, '该写点请求不属于当前会话')
    assert.ok(peekPendingWrite(cwd, id), "A's request must remain pending")
    assert.equal(writtenValues(home, cwd).length, 0)
    const kinds = timelineKinds(home, cwd)
    assert.ok(!kinds.includes('write-reject'))
    assert.ok(!kinds.includes('write-start'))
    assert.ok(!kinds.includes('write-end'))
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'write').length, 0)
    // The owner can still act on it afterwards.
    const own = await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_A })
    assert.equal(own.ok, true)
    assert.deepEqual(own.readback, [33])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('foreign session cannot reject: request survives and no reject is recorded', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-foreign-reject-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 4, 44)
    const ran = await resolvePendingWrite(home, cwd, id, false, { sessionId: SESSION_B })
    assert.equal(ran.ok, false)
    assert.equal(ran.rejected, undefined)
    assert.equal(ran.errorCode, ERROR_CODES.SESSION_MISMATCH)
    assert.ok(peekPendingWrite(cwd, id))
    assert.ok(!timelineKinds(home, cwd).includes('write-reject'))
    const own = await resolvePendingWrite(home, cwd, id, false, { sessionId: SESSION_A })
    assert.equal(own.rejected, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('anonymous caller gets SESSION_REQUIRED and the request is not consumed', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-anon-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 5, 55)
    for (const opts of [undefined, {}, { sessionId: '' }]) {
      const ran = await resolvePendingWrite(home, cwd, id, true, opts)
      assert.equal(ran.ok, false)
      assert.equal(ran.errorCode, ERROR_CODES.SESSION_REQUIRED)
    }
    assert.ok(peekPendingWrite(cwd, id))
    assert.equal(writtenValues(home, cwd).length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('repeat approve after a successful approve reports PENDING_WRITE_NOT_FOUND', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-repeat-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 6, 66)
    assert.equal((await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_A })).ok, true)
    const again = await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_A })
    assert.equal(again.ok, false)
    assert.equal(again.errorCode, ERROR_CODES.PENDING_WRITE_NOT_FOUND)
    const foreign = await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_B })
    assert.equal(foreign.errorCode, ERROR_CODES.PENDING_WRITE_NOT_FOUND)
    const unknown = await resolvePendingWrite(home, cwd, 'pw-does-not-exist', true, { sessionId: SESSION_A })
    assert.equal(unknown.errorCode, ERROR_CODES.PENDING_WRITE_NOT_FOUND)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('listPendingWrites is scoped per session and empty without a session', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-list-')
  try {
    const idA = await raisePendingWrite(home, cwd, SESSION_A, 7, 77)
    const idB = await raisePendingWrite(home, cwd, SESSION_B, 8, 88)
    assert.deepEqual(
      listPendingWrites(cwd, SESSION_A).map((item) => item.id),
      [idA],
    )
    assert.deepEqual(
      listPendingWrites(cwd, SESSION_B).map((item) => item.id),
      [idB],
    )
    assert.deepEqual(listPendingWrites(cwd, undefined), [])
    assert.deepEqual(listPendingWrites(cwd, ''), [])
    assert.deepEqual(listPendingWrites(cwd, 'session-c'), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('takePendingWrite only consumes on success', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-take-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 9, 99)
    assert.equal(takePendingWrite(cwd, id, '').errorCode, ERROR_CODES.SESSION_REQUIRED)
    assert.equal(takePendingWrite(cwd, id, SESSION_B).errorCode, ERROR_CODES.SESSION_MISMATCH)
    assert.ok(peekPendingWrite(cwd, id))
    const taken = takePendingWrite(cwd, id, SESSION_A)
    assert.equal(taken.ok, true)
    assert.equal(taken.entry.id, id)
    assert.equal(peekPendingWrite(cwd, id), null)
    assert.equal(takePendingWrite(cwd, id, SESSION_A).errorCode, ERROR_CODES.PENDING_WRITE_NOT_FOUND)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('RPC state and approve carry session ownership end to end', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-rpc-')
  const { _internal } = await import('../host.js')
  _internal.setDshHome(home)
  const router = createVisionRpcRouter({ getHome: () => home })
  const signal = () => AbortSignal.timeout(5000)
  try {
    const idA = await raisePendingWrite(home, cwd, SESSION_A, 1, 101)
    const stateA = await router.dispatch('state', { cwd, sessionId: SESSION_A }, signal())
    assert.deepEqual(
      stateA.pendingWrites.map((item) => item.id),
      [idA],
    )
    const stateB = await router.dispatch('state', { cwd, sessionId: SESSION_B }, signal())
    assert.deepEqual(stateB.pendingWrites, [])
    const stateAnon = await router.dispatch('state', { cwd }, signal())
    assert.deepEqual(stateAnon.pendingWrites, [])

    const foreign = await router.dispatch(
      'modbus/write/approve',
      { cwd, sessionId: SESSION_B, id: idA, approved: true },
      signal(),
    )
    assert.equal(foreign.ok, false)
    assert.equal(foreign.errorCode, ERROR_CODES.SESSION_MISMATCH)
    const anon = await router.dispatch('modbus/write/approve', { cwd, id: idA, approved: true }, signal())
    assert.equal(anon.errorCode, ERROR_CODES.SESSION_REQUIRED)
    assert.equal(writtenValues(home, cwd).length, 0)
    const stillA = await router.dispatch('state', { cwd, sessionId: SESSION_A }, signal())
    assert.deepEqual(
      stillA.pendingWrites.map((item) => item.id),
      [idA],
    )

    const own = await router.dispatch(
      'modbus/write/approve',
      { cwd, sessionId: SESSION_A, id: idA, approved: true },
      signal(),
    )
    assert.equal(own.ok, true)
    assert.deepEqual(own.readback, [101])
    const afterA = await router.dispatch('state', { cwd, sessionId: SESSION_A }, signal())
    assert.deepEqual(afterA.pendingWrites, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('endpoint drift check still runs for the owning session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-approval-drift-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
    const first = await runVisionBench(
      home,
      { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] },
      cwd,
      { source: 'agent', sessionId: SESSION_A },
    )
    assert.equal(first.needsConfirm, true)
    // Patch the owning session's private layer (flat saveWorkspace would only touch the shared slice).
    const patched = await saveSessionModbusPatch(home, cwd, SESSION_A, {
      modbus: { connections: [{ ...c1, conn: { ...c1.conn, port: 'COM11' } }] },
    })
    assert.equal(patched.ok, true, patched.error)
    // A foreign session is still refused before drift is evaluated and the request survives.
    const foreign = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: SESSION_B })
    assert.equal(foreign.errorCode, ERROR_CODES.SESSION_MISMATCH)
    assert.ok(peekPendingWrite(cwd, first.requestId))
    const drifted = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: SESSION_A })
    assert.equal(drifted.ok, false)
    assert.equal(drifted.errorCode, ERROR_CODES.ENDPOINT_DRIFT)
    assert.ok(timelineKinds(home, cwd).includes('write-stale'))
    assert.equal(peekPendingWrite(cwd, first.requestId), null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('configVersion drift check still runs for the owning session', async () => {
  const { home, cwd } = await setupBoard('dvb-approval-config-drift-')
  try {
    const id = await raisePendingWrite(home, cwd, SESSION_A, 0, 5)
    const before = loadWorkspace(home, cwd).modbus.configVersion || 1
    // Bump configVersion via a point-table change that keeps the endpoint identical.
    saveWorkspace(home, cwd, {
      modbus: {
        points: Array.from({ length: 10 }, (_, i) => ({ name: 'HR' + i + '-renamed', function: 3, address: i })),
      },
    })
    const after = loadWorkspace(home, cwd).modbus.configVersion || 1
    assert.ok(after > before, 'test setup must bump configVersion')
    const drifted = await resolvePendingWrite(home, cwd, id, true, { sessionId: SESSION_A })
    assert.equal(drifted.ok, false)
    assert.equal(drifted.errorCode, ERROR_CODES.CONFIG_DRIFT)
    assert.ok(timelineKinds(home, cwd).includes('write-stale'))
    assert.equal(writtenValues(home, cwd).length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
