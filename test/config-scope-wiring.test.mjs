import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { _internal } from '../host.js'
import { mutateConfig } from '../src/application/config/config-mutation-service.mjs'
import { ERROR_CODES } from '../src/domain/modbus/errors.mjs'
import { createVisionRpcRouter } from '../src/interfaces/rpc/vision-rpc-router.mjs'

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'

const LEGACY_CONN = {
  id: 'legacy-c1',
  name: 'Legacy link',
  role: 'client',
  enabled: true,
  conn: { mode: 'tcp', host: '10.0.0.1', sim: true },
}
const LEGACY_DEV = { id: 'legacy-d1', connectionId: 'legacy-c1', name: 'Legacy dev', unitId: 1 }
const LEGACY_POINT = {
  id: 'legacy-p1',
  connectionId: 'legacy-c1',
  deviceId: 'legacy-d1',
  name: 'Legacy HR0',
  area: 'holdingRegister',
  function: 3,
  address: 0,
}

/**
 * Seed a pre-upgrade workspace: a single flat modbus blob with no session partition.
 * @param {string} prefix
 * @param {boolean} [withLegacyTopology]
 */
async function setupBoard(prefix, withLegacyTopology = true) {
  const home = await mkdtemp(join(tmpdir(), prefix))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  saveWorkspace(home, cwd, {
    modbus: withLegacyTopology
      ? { version: 3, connections: [LEGACY_CONN], devices: [LEGACY_DEV], points: [LEGACY_POINT] }
      : { version: 3, connections: [], devices: [], points: [] },
  })
  _internal.setDshHome(home)
  const router = createVisionRpcRouter({ getHome: () => home })
  /** @param {string} sessionId */
  const state = async (sessionId) => {
    const snap = await router.dispatch('state', { cwd, sessionId }, AbortSignal.timeout(5000))
    assert.equal(snap.ok, true, snap.error)
    return snap
  }
  return { home, cwd, router, state }
}

/** @param {any} snap */
const connectionIds = (snap) => (snap.workspace.modbus.connections || []).map((/** @type {any} */ c) => c.id)
/** @param {any} snap */
const deviceIds = (snap) => (snap.workspace.modbus.devices || []).map((/** @type {any} */ d) => d.id)
/** @param {any} snap */
const pointIds = (snap) => (snap.workspace.modbus.points || []).map((/** @type {any} */ p) => p.id)
/** @param {any} snap */
const configVersionOf = (snap) => snap.workspace.modbus.configVersion

/**
 * @param {{ home: string, cwd: string }} board
 * @param {string} sessionId
 * @param {number} expectedConfigVersion
 * @param {string} operation
 * @param {any} target
 * @param {any} value
 */
const mutateAs = (board, sessionId, expectedConfigVersion, operation, target, value) =>
  mutateConfig({
    home: board.home,
    cwd: board.cwd,
    source: 'user',
    sessionId,
    expectedConfigVersion,
    operation,
    target,
    value,
  })

/**
 * @param {{ home: string, cwd: string }} board
 * @param {string} sessionId
 * @param {number} expectedConfigVersion
 * @param {Record<string, boolean>} share
 * @param {boolean} confirmed
 */
const shareUpdate = (board, sessionId, expectedConfigVersion, share, confirmed) =>
  mutateAs(board, sessionId, expectedConfigVersion, 'share.update', {}, { share, confirmed })

const A_CONN_VALUE = { name: 'A link', conn: { mode: 'tcp', host: '10.0.0.2', sim: true } }

test('legacy workspace: first session claims the flat topology privately; second session starts empty', async () => {
  const board = await setupBoard('dvb-scope-claim-')
  try {
    const a = await board.state(SESSION_A)
    assert.ok(connectionIds(a).includes('legacy-c1'), 'first session keeps legacy connections')
    assert.ok(deviceIds(a).includes('legacy-d1'))
    assert.ok(pointIds(a).includes('legacy-p1'))
    assert.equal(loadWorkspace(board.home, board.cwd).modbus.privateClaimSessionId, SESSION_A)

    const b = await board.state(SESSION_B)
    assert.ok(!connectionIds(b).includes('legacy-c1'), 'second session must not inherit legacy connections')
    assert.ok(!deviceIds(b).includes('legacy-d1'))
    assert.deepEqual(pointIds(b), [])

    // Claim is persisted; re-reading as A or B is stable and B did not steal the claim.
    const again = await board.state(SESSION_A)
    assert.ok(connectionIds(again).includes('legacy-c1'))
    assert.equal(loadWorkspace(board.home, board.cwd).modbus.privateClaimSessionId, SESSION_A)

    // Anonymous state (no session) does not claim and sees no private topology.
    const anon = await board.router.dispatch('state', { cwd: board.cwd }, AbortSignal.timeout(5000))
    assert.equal(anon.ok, true)
    assert.ok(!connectionIds(anon).includes('legacy-c1'))
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})

test('state exposes share flags on modbus (defaults all off) for the settings UI', async () => {
  const board = await setupBoard('dvb-scope-flags-', false)
  try {
    const a = await board.state(SESSION_A)
    assert.deepEqual(a.workspace.modbus.share, {
      enabled: false,
      connections: false,
      points: false,
      visualization: false,
    })
    assert.equal(a.workspace.modbus.sessionConfigs, undefined, 'private layers of other sessions are not leaked')
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})

test('two sessions on one cwd: private by default, share.update publishes, revoke needs confirm', async () => {
  const board = await setupBoard('dvb-scope-share-', false)
  try {
    // 1) A creates a connection privately → B does not see it.
    const a0 = await board.state(SESSION_A)
    const created = await mutateAs(
      board,
      SESSION_A,
      configVersionOf(a0),
      'connection.create',
      { connectionId: 'cA' },
      A_CONN_VALUE,
    )
    assert.equal(created.ok, true, created.error)
    assert.equal(created.nextConfigVersion, configVersionOf(a0) + 1)
    assert.ok(
      (created.connections || []).some((/** @type {any} */ c) => c.id === 'cA'),
      'mutateConfig returns the effective (projected) topology for the mutating session',
    )
    const dev = await mutateAs(
      board,
      SESSION_A,
      created.nextConfigVersion,
      'device.create',
      { connectionId: 'cA', deviceId: 'dA' },
      { name: 'A dev', unitId: 7 },
    )
    assert.equal(dev.ok, true, dev.error)

    const a1 = await board.state(SESSION_A)
    assert.ok(connectionIds(a1).includes('cA'))
    assert.ok(deviceIds(a1).includes('dA'))
    const b1 = await board.state(SESSION_B)
    assert.ok(!connectionIds(b1).includes('cA'), 'B must not see A private connection')
    assert.ok(!deviceIds(b1).includes('dA'))

    // 2) A enables master + connections (confirmed) → B sees and can edit the connection.
    const shared = await shareUpdate(board, SESSION_A, configVersionOf(a1), { enabled: true, connections: true }, true)
    assert.equal(shared.ok, true, shared.error)
    assert.equal(shared.nextConfigVersion, configVersionOf(a1) + 1, 'share change bumps configVersion')
    const b2 = await board.state(SESSION_B)
    assert.ok(connectionIds(b2).includes('cA'), 'B sees shared connection')
    assert.ok(deviceIds(b2).includes('dA'), 'connections share covers devices')
    assert.equal(b2.workspace.modbus.share.enabled, true)
    assert.equal(b2.workspace.modbus.share.connections, true)
    assert.equal(b2.workspace.modbus.share.points, false)

    const renamed = await mutateAs(
      board,
      SESSION_B,
      configVersionOf(b2),
      'connection.update',
      { connectionId: 'cA' },
      { name: 'renamed by B' },
    )
    assert.equal(renamed.ok, true, renamed.error)
    const a2 = await board.state(SESSION_A)
    assert.equal(
      a2.workspace.modbus.connections.find((/** @type {any} */ c) => c.id === 'cA').name,
      'renamed by B',
      'shared slice is live-edited by both sessions',
    )

    // 3) Turning share off without confirmation is refused and nothing changes.
    const unconfirmed = await shareUpdate(board, SESSION_A, configVersionOf(a2), { enabled: false }, false)
    assert.equal(unconfirmed.ok, false)
    assert.equal(unconfirmed.needsConfirm, true)
    assert.equal(unconfirmed.errorCode, ERROR_CODES.SHARE_REVOKE_CONFIRM_REQUIRED)
    const b3 = await board.state(SESSION_B)
    assert.ok(connectionIds(b3).includes('cA'), 'still shared after refused revoke')
    assert.equal(configVersionOf(b3), configVersionOf(a2), 'refused revoke does not bump configVersion')
    assert.equal(b3.workspace.modbus.share.enabled, true)

    // 4) Confirmed revoke: B loses the connection, A keeps it privately.
    const revoked = await shareUpdate(board, SESSION_A, configVersionOf(a2), { enabled: false }, true)
    assert.equal(revoked.ok, true, revoked.error)
    const b4 = await board.state(SESSION_B)
    assert.ok(!connectionIds(b4).includes('cA'), 'B no longer sees revoked connection')
    assert.equal(b4.workspace.modbus.share.enabled, false)
    const a4 = await board.state(SESSION_A)
    assert.ok(connectionIds(a4).includes('cA'), 'revoking session keeps editing continuity')
    assert.equal(a4.workspace.modbus.connections.find((/** @type {any} */ c) => c.id === 'cA').name, 'renamed by B')
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})

test('granular share: points only → B sees shared points but not A private connections', async () => {
  const board = await setupBoard('dvb-scope-granular-')
  try {
    const a0 = await board.state(SESSION_A)
    const shared = await shareUpdate(board, SESSION_A, configVersionOf(a0), { enabled: true, points: true }, true)
    assert.equal(shared.ok, true, shared.error)
    const b = await board.state(SESSION_B)
    assert.ok(pointIds(b).includes('legacy-p1'), 'points slice is shared')
    assert.ok(!connectionIds(b).includes('legacy-c1'), 'connections slice stays private to A')
    const a = await board.state(SESSION_A)
    assert.ok(pointIds(a).includes('legacy-p1'))
    assert.ok(connectionIds(a).includes('legacy-c1'))
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})

test('topology mutations without a sessionId are refused once the workspace is partitioned', async () => {
  const board = await setupBoard('dvb-scope-session-required-')
  try {
    const a0 = await board.state(SESSION_A)
    const anon = await mutateConfig({
      home: board.home,
      cwd: board.cwd,
      expectedConfigVersion: configVersionOf(a0),
      operation: 'connection.create',
      target: { connectionId: 'ghost' },
      value: A_CONN_VALUE,
    })
    assert.equal(anon.ok, false)
    assert.equal(anon.errorCode, ERROR_CODES.SESSION_REQUIRED)
    const anonShare = await mutateConfig({
      home: board.home,
      cwd: board.cwd,
      expectedConfigVersion: configVersionOf(a0),
      operation: 'share.update',
      target: {},
      value: { share: { enabled: true, connections: true }, confirmed: true },
    })
    assert.equal(anonShare.errorCode, ERROR_CODES.SESSION_REQUIRED)
    const after = await board.state(SESSION_A)
    assert.equal(configVersionOf(after), configVersionOf(a0), 'refused mutation does not write')
    assert.ok(!connectionIds(after).includes('ghost'))
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})

test('share.update honours expectedConfigVersion (CONFIG_DRIFT) and rejects unknown flags shape', async () => {
  const board = await setupBoard('dvb-scope-drift-', false)
  try {
    const a0 = await board.state(SESSION_A)
    const drift = await shareUpdate(
      board,
      SESSION_A,
      configVersionOf(a0) + 5,
      { enabled: true, connections: true },
      true,
    )
    assert.equal(drift.ok, false)
    assert.equal(drift.errorCode, 'CONFIG_DRIFT')
    const flat = await mutateAs(
      board,
      SESSION_A,
      configVersionOf(a0),
      'share.update',
      {},
      { enabled: true, points: true, confirmed: true },
    )
    assert.equal(flat.ok, true, 'flags may also be passed flat on value')
    const b = await board.state(SESSION_B)
    assert.equal(b.workspace.modbus.share.points, true)
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})

test('mutateConfig on a session-private point via RPC points/flags resolves inside the private layer', async () => {
  const board = await setupBoard('dvb-scope-flags-rpc-')
  try {
    const a0 = await board.state(SESSION_A)
    const ran = await board.router.dispatch(
      'points/flags',
      {
        cwd: board.cwd,
        sessionId: SESSION_A,
        pointId: 'legacy-p1',
        monitorEnabled: false,
        expectedConfigVersion: configVersionOf(a0),
      },
      AbortSignal.timeout(5000),
    )
    assert.equal(ran.ok, true, ran.error)
    assert.equal(ran.point.id, 'legacy-p1')
    assert.equal(ran.point.monitorEnabled, false)
    const foreign = await board.router.dispatch(
      'points/flags',
      {
        cwd: board.cwd,
        sessionId: SESSION_B,
        pointId: 'legacy-p1',
        monitorEnabled: true,
        expectedConfigVersion: ran.configVersion,
      },
      AbortSignal.timeout(5000),
    )
    assert.equal(foreign.ok, false, 'B cannot see (or flip) A private point')
  } finally {
    await rm(board.home, { recursive: true, force: true })
  }
})
