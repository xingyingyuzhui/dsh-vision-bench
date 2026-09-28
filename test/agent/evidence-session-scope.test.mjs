// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { appendEvidence, loadWorkspace, saveWorkspace, workspaceKey } from '../../bench-store.mjs'
import { workspaceDir } from '../../src/infrastructure/persistence/workspace-migration.mjs'
import { createDebugSessionRegistry } from '../../src/application/debug/debug-session-registry.mjs'
import { collectVisibleEvidenceRefs } from '../../src/application/modbus/evidence-scope.mjs'
import { requestFocus } from '../../src/application/modbus/focus-service.mjs'
import { projectModbusForSession } from '../../src/application/modbus/config-scope-service.mjs'
import { createVisionRpcRouter } from '../../src/interfaces/rpc/vision-rpc-router.mjs'
import { sessionWorkspaceView } from '../../src/interfaces/rpc/vision-rpc-workspace.mjs'
import { postEvidence } from '../../src/ui/common/agent-reference.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

const A = 'session-a'
const B = 'session-b'

/** @param {string} id @param {string} cid @param {string} did */
const point = (id, cid, did) => ({ id, name: id, connectionId: cid, deviceId: did, function: 3, address: 0, area: 'holdingRegister' })

/**
 * @param {any} t
 * @param {{ focus?: any }} [extra]
 */
async function twoSessionBench(t, extra = {}) {
  const bench = await createBench(t, { prefix: 'dvb-ev-scope-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 5,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: A,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [A]: {
          connections: [connection('c-a', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-a', connectionId: 'c-a', name: 'DA', unitId: 1 }],
          points: [point('pa', 'c-a', 'd-a')],
          visualization: { schemaVersion: 2, components: [] },
        },
        [B]: {
          connections: [connection('c-b', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-b', connectionId: 'c-b', name: 'DB', unitId: 1 }],
          points: [point('pb', 'c-b', 'd-b')],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
    timeline: [
      { id: 'b-event', at: 30, kind: 'read', source: 'agent', sessionId: B, taskId: '', ok: true, summary: 'b' },
      { id: 'a-event', at: 20, kind: 'read', source: 'agent', sessionId: A, taskId: '', ok: true, summary: 'a' },
      { id: 'legacy-event', at: 10, kind: 'read', source: 'user', sessionId: '', taskId: '', ok: true, summary: 'x' },
    ],
    tasks: [
      { id: 'b-build', type: 'build', status: 'ok', sessionId: B, startedAt: 3, endedAt: 4, progress: 0 },
      { id: 'a-build', type: 'build', status: 'ok', sessionId: A, startedAt: 1, endedAt: 2, progress: 0 },
    ],
    ...extra,
  })
  return bench
}

/**
 * On-disk config + runtime, minus the Host session binding (`session.boundId`),
 * which every Host command refreshes for notifications and is not evidence state.
 * @param {string} home @param {string} cwd
 */
function diskBytes(home, cwd) {
  const dir = workspaceDir(home, workspaceKey(cwd))
  return ['config.json', 'runtime.json'].map((name) => {
    const json = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    delete json.session
    return JSON.stringify(json)
  })
}

/** @param {any[]} refs */
const idsOf = (refs) => refs.map((r) => `${r.kind}:${r.id}`).sort()

test('evidence, status and alarm only expose the caller session references', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const before = diskBytes(home, cwd)
  const a = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'agent', sessionId: A })
  assert.equal(a.ok, true, a.error)
  assert.deepEqual(idsOf(a.evidence), ['build:a-build', 'log:a-event', 'point:pa'])
  const b = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'user', sessionId: B })
  assert.deepEqual(idsOf(b.evidence), ['build:b-build', 'log:b-event', 'point:pb'])

  const status = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: A })
  assert.deepEqual(idsOf(status.evidence), idsOf(a.evidence))
  const alarm = await runVisionBench(home, { action: 'alarm', connectionId: 'c-a' }, cwd, { source: 'user', sessionId: A })
  assert.equal(alarm.ok, true, alarm.error)
  assert.deepEqual(idsOf(alarm.evidence), idsOf(a.evidence))
  assert.deepEqual(diskBytes(home, cwd), before)

  const anon = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'agent', sessionId: '' })
  assert.equal(anon.ok, false)
  assert.equal(anon.errorCode, 'SESSION_REQUIRED')
})

test('evidence rejects top-level kind/id and non-array evidence', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const topKind = await runVisionBench(home, { action: 'evidence', kind: 'log', id: 'a-event' }, cwd, { source: 'agent', sessionId: A })
  assert.equal(topKind.errorCode, 'INVALID_FIELD')
  assert.match(topKind.hint, /timeline\.list/)
  const obj = await runVisionBench(home, { action: 'evidence', evidence: { kind: 'point', id: 'pa' } }, cwd, { source: 'agent', sessionId: A })
  assert.equal(obj.errorCode, 'INVALID_FIELD')
})

test('legacy workspace evidence listing does not persist a claim', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-ev-legacy-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
      points: [point('p1', 'c1', 'd1')],
    },
  })
  const before = diskBytes(home, cwd)
  const listed = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'agent', sessionId: A })
  assert.equal(listed.ok, true, listed.error)
  assert.deepEqual(idsOf(listed.evidence), ['point:p1'])
  assert.deepEqual(diskBytes(home, cwd), before)
  assert.equal(loadWorkspace(home, cwd).modbus.privateClaimSessionId || '', '')
})

test('append refuses another session log/build and leaves disk unchanged', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const before = diskBytes(home, cwd)
  for (const ev of [
    { kind: 'log', id: 'b-event' },
    { kind: 'build', id: 'b-build' },
    { kind: 'log', id: 'legacy-event' },
    { kind: 'log', id: 'rotated-away' },
    { kind: 'point', id: 'pb', connectionId: 'c-b', deviceId: 'd-b' },
    { kind: 'debug_snapshot', id: 'snap-b' },
  ]) {
    const r = await appendEvidence(home, cwd, [ev], A)
    assert.equal(r.ok, false, `${ev.kind}:${ev.id} must be refused`)
    assert.equal(r.errorCode, 'TARGET_MISMATCH', `${ev.kind}:${ev.id}`)
  }
  const unknown = await appendEvidence(home, cwd, [{ kind: 'mystery', id: 'x' }], A)
  assert.equal(unknown.errorCode, 'INVALID_FIELD')
  const drift = await appendEvidence(home, cwd, [{ kind: 'point', id: 'pa', connectionId: 'c-a', deviceId: 'd-a', version: 1 }], A)
  assert.equal(drift.errorCode, 'CONFIG_DRIFT')
  const batch = await appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }, { kind: 'log', id: 'b-event' }], A)
  assert.equal(batch.ok, false)
  const anon = await appendEvidence(home, cwd, [{ kind: 'log', id: 'legacy-event' }], '')
  assert.equal(anon.errorCode, 'SESSION_REQUIRED')
  assert.deepEqual(diskBytes(home, cwd), before)

  const ok = await appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }, { kind: 'build', id: 'a-build' }], A)
  assert.equal(ok.ok, true, ok.error)
  const focus = loadWorkspace(home, cwd).focus
  assert.equal(focus.sessionId, A)
  assert.deepEqual(focus.evidence.map((/** @type {any} */ r) => [r.kind, r.id, r.sessionId]), [
    ['log', 'a-event', A],
    ['build', 'a-build', A],
  ])
})

test('unpartitioned: a session caller cannot cite unattributed events; anonymous cannot cite owned ones', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-ev-unpart-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: { version: 3, connections: [connection('c1', 'tcp', '', { sim: true })], devices: [], points: [] },
    timeline: [
      { id: 'owned', at: 2, kind: 'read', source: 'agent', sessionId: A, taskId: '', ok: true, summary: '' },
      { id: 'legacy', at: 1, kind: 'read', source: 'user', sessionId: '', taskId: '', ok: true, summary: '' },
    ],
  })
  assert.equal((await appendEvidence(home, cwd, [{ kind: 'log', id: 'legacy' }], A)).errorCode, 'TARGET_MISMATCH')
  assert.equal((await appendEvidence(home, cwd, [{ kind: 'log', id: 'owned' }], '')).errorCode, 'TARGET_MISMATCH')
  assert.equal((await appendEvidence(home, cwd, [{ kind: 'log', id: 'legacy' }], '')).ok, true)
})

test('a focus owned by B blocks A appends and A focus requests', async (t) => {
  const { home, cwd } = await twoSessionBench(t, {
    focus: {
      sessionId: B,
      request: { connectionId: 'c-b', deviceId: 'd-b', pointId: 'pb', kind: 'point', at: 1, version: 5 },
      evidence: [{ kind: 'point', id: 'pb', connectionId: 'c-b', deviceId: 'd-b', sessionId: B }],
    },
  })
  const before = diskBytes(home, cwd)
  const append = await appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }], A)
  assert.equal(append.errorCode, 'SESSION_MISMATCH')
  const focusA = await requestFocus(home, cwd, { target: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' } }, { source: 'user', sessionId: A })
  assert.equal(focusA.errorCode, 'SESSION_MISMATCH')
  const viaAgent = await runVisionBench(home, { action: 'focus', connectionId: 'c-a', pointId: 'pa' }, cwd, { source: 'agent', sessionId: A })
  assert.equal(viaAgent.errorCode, 'SESSION_MISMATCH')
  assert.deepEqual(diskBytes(home, cwd), before)
})

test('focus evidence goes through the same validation', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const before = diskBytes(home, cwd)
  const bad = await requestFocus(
    home,
    cwd,
    { target: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' }, evidence: [{ kind: 'log', id: 'b-event' }], sessionId: A },
    { source: 'user', sessionId: '' },
  )
  assert.equal(bad.errorCode, 'SESSION_REQUIRED')
  const foreign = await requestFocus(
    home,
    cwd,
    { target: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' }, evidence: [{ kind: 'log', id: 'b-event' }] },
    { source: 'user', sessionId: A },
  )
  assert.equal(foreign.errorCode, 'TARGET_MISMATCH')
  assert.deepEqual(diskBytes(home, cwd), before)
  const ok = await requestFocus(
    home,
    cwd,
    { target: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' }, evidence: [{ kind: 'log', id: 'a-event' }] },
    { source: 'user', sessionId: A },
  )
  assert.equal(ok.ok, true, ok.error)
  assert.equal(loadWorkspace(home, cwd).focus.evidence[0].sessionId, A)
})

test('stored focus evidence is filtered per caller at Host status and RPC view', async (t) => {
  const { home, cwd } = await twoSessionBench(t, {
    focus: {
      sessionId: A,
      request: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa', kind: 'point', at: 1, version: 5 },
      evidence: [
        { kind: 'log', id: 'a-event' },
        { kind: 'log', id: 'b-event' },
        { kind: 'point', id: 'pb', connectionId: 'c-b', deviceId: 'd-b' },
        { kind: 'point', id: 'pa', connectionId: 'c-a', deviceId: 'd-a', sessionId: B },
      ],
    },
  })
  const before = diskBytes(home, cwd)
  const status = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: A })
  assert.deepEqual(status.focus.evidence.map((/** @type {any} */ r) => r.id), ['a-event'])
  assert.equal(status.focus.evidenceHiddenCount, 3)
  const statusB = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: B })
  assert.equal(statusB.focus.request, null)
  assert.deepEqual(statusB.focus.evidence, [])

  const layered = loadWorkspace(home, cwd)
  const viewA = sessionWorkspaceView(layered, A, cwd)
  assert.deepEqual(viewA.focus.evidence.map((/** @type {any} */ r) => r.id), ['a-event'])
  assert.equal(viewA.focusEvidenceHiddenCount, 3)
  const viewB = sessionWorkspaceView(layered, B, cwd)
  assert.equal(viewB.focus.request, null)
  assert.equal(JSON.stringify(viewB.focus).includes('a-event'), false)
  assert.deepEqual(diskBytes(home, cwd), before)
  assert.equal(loadWorkspace(home, cwd).focus.evidence.length, 4)
})

test('UI postEvidence → RPC → store carries the page session and is authorized', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const router = createVisionRpcRouter({ getHome: () => home })
  const post = (/** @type {string} */ url, /** @type {any} */ body) =>
    router.dispatch(url.replace('/dsh-vision-bench/', ''), body)
  const noSid = await postEvidence(post, cwd, { kind: 'log', id: 'a-event' }, () => {})
  assert.equal(noSid.errorCode, 'SESSION_REQUIRED')
  const foreign = await postEvidence(post, cwd, { kind: 'log', id: 'b-event' }, () => {}, { sessionId: A })
  assert.equal(foreign.errorCode, 'TARGET_MISMATCH')
  const own = await postEvidence(post, cwd, { kind: 'log', id: 'a-event' }, () => {}, { sessionId: A })
  assert.equal(own.ok, true, own.error)
  assert.equal(loadWorkspace(home, cwd).focus.evidence[0].sessionId, A)

  const snap = await router.snapshot(cwd, B)
  assert.equal(/** @type {any} */ (snap).workspace.focus.request, null)
  assert.deepEqual(/** @type {any} */ (snap).workspace.focus.evidence, [])
})

test('concurrent appends keep both rows', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const [x, y] = await Promise.all([
    appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }], A),
    appendEvidence(home, cwd, [{ kind: 'build', id: 'a-build' }], A),
  ])
  assert.equal(x.ok && y.ok, true)
  const ids = loadWorkspace(home, cwd).focus.evidence.map((/** @type {any} */ r) => r.id).sort()
  assert.deepEqual(ids, ['a-build', 'a-event'])
})

test('debug snapshot refs only resolve inside the owner session and workspace', () => {
  const registry = createDebugSessionRegistry()
  const base = { state: 'stopped', breakpoints: new Map(), watchpoints: new Map() }
  registry.sessions.set('dbg-b', {
    ...base,
    debugSessionId: 'dbg-b',
    ownerSessionId: B,
    workspaceCwd: '/proj',
    snapshots: [
      { id: 'snap-b1', reason: 'manual', createdAt: 1, location: { file: 'main.c', line: 3 } },
      { id: 'snap-b2', reason: 'bp', createdAt: 2, location: { file: 'main.c', line: 9 } },
    ],
  })
  assert.equal(registry.latestOwnedSnapshotRef({ ownerSessionId: A, workspaceCwd: '/proj' }), null)
  assert.equal(registry.latestOwnedSnapshotRef({ ownerSessionId: B, workspaceCwd: '/other' }), null)
  const latest = registry.latestOwnedSnapshotRef({ ownerSessionId: B, workspaceCwd: '/proj' })
  assert.equal(latest.snapshotId, 'snap-b2')
  assert.equal(latest.line, 9)
  assert.equal(registry.resolveOwnedSnapshotRef({ ownerSessionId: A, workspaceCwd: '/proj', snapshotId: 'snap-b1' }), null)
  assert.equal(registry.resolveOwnedSnapshotRef({ ownerSessionId: B, workspaceCwd: '/proj', snapshotId: 'snap-b1' }).id, 'snap-b1')

  const modbus = { version: 3, connections: [], devices: [], points: [] }
  const scope = (/** @type {string} */ sid) => ({
    workspace: { modbus, timeline: [], tasks: [] },
    pack: projectModbusForSession(modbus, sid),
    sessionId: sid,
    cwd: '/proj',
    debug: registry,
  })
  assert.equal(collectVisibleEvidenceRefs(scope(A)).some((r) => r.kind === 'debug_snapshot'), false)
  assert.equal(collectVisibleEvidenceRefs(scope(B)).find((r) => r.kind === 'debug_snapshot')?.id, 'snap-b2')
})
