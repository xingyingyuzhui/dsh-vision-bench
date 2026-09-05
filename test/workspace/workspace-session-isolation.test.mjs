// @ts-check
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { _internal } from '../../host.js'
import { createVisionRpcRouter } from '../../src/interfaces/rpc/vision-rpc-router.mjs'

test('workspace/get isolates private sessions and strips sessionConfigs', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ws-iso-'))
  t.after(async () => {
    await rm(home, { recursive: true, force: true }).catch(() => {})
  })
  const cwd = join(home, 'board')
  await mkdir(cwd)
  _internal.setDshHome(home)

  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-A': {
          connections: [
            {
              id: 'conn-A',
              name: 'Private A',
              role: 'client',
              enabled: true,
              conn: { mode: 'tcp', host: '127.0.0.1' },
            },
          ],
          devices: [],
          points: [],
        },
        'session-B': {
          connections: [
            {
              id: 'conn-B',
              name: 'Private B',
              role: 'client',
              enabled: true,
              conn: { mode: 'tcp', host: '127.0.0.1' },
            },
          ],
          devices: [],
          points: [],
        },
      },
    },
  })

  const router = createVisionRpcRouter({ getHome: () => home })

  const resA = await router.dispatch('workspace/get', { cwd, sessionId: 'session-A' })
  assert.equal(resA.ok, true)
  assert.equal(resA.workspace.modbus.sessionConfigs, undefined, 'sessionConfigs must be stripped')
  const connsA = resA.workspace.modbus.connections || []
  assert.equal(connsA.length, 1)
  assert.equal(connsA[0].id, 'conn-A')

  const resB = await router.dispatch('workspace/get', { cwd, sessionId: 'session-B' })
  assert.equal(resB.ok, true)
  assert.equal(resB.workspace.modbus.sessionConfigs, undefined, 'sessionConfigs must be stripped')
  const connsB = resB.workspace.modbus.connections || []
  assert.equal(connsB.length, 1)
  assert.equal(connsB[0].id, 'conn-B')
})

test('workspace/save rejects forbidden config keys and preserves cross-session state', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ws-save-iso-'))
  t.after(async () => {
    await rm(home, { recursive: true, force: true }).catch(() => {})
  })
  const cwd = join(home, 'board')
  await mkdir(cwd)
  _internal.setDshHome(home)

  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-A': {
          connections: [
            {
              id: 'conn-A',
              name: 'Private A',
              role: 'client',
              enabled: true,
              conn: { mode: 'tcp', host: '127.0.0.1' },
            },
          ],
          devices: [],
          points: [],
          activeConnectionId: 'conn-A',
        },
        'session-B': {
          connections: [
            {
              id: 'conn-B',
              name: 'Private B',
              role: 'client',
              enabled: true,
              conn: { mode: 'tcp', host: '127.0.0.1' },
            },
          ],
          devices: [],
          points: [],
          activeConnectionId: '',
        },
      },
    },
  })

  const router = createVisionRpcRouter({ getHome: () => home })

  // 1. Rejection of sessionConfigs bypass
  const resRejectConfigs = await router.dispatch('workspace/save', {
    cwd,
    sessionId: 'session-B',
    modbus: { sessionConfigs: {} },
  })
  assert.equal(resRejectConfigs.ok, false)
  assert.equal(resRejectConfigs.errorCode, 'CONFIG_COMMAND_REQUIRED')

  // 2. Rejection of share bypass
  const resRejectShare = await router.dispatch('workspace/save', {
    cwd,
    sessionId: 'session-B',
    modbus: { share: { enabled: true } },
  })
  assert.equal(resRejectShare.ok, false)
  assert.equal(resRejectShare.errorCode, 'CONFIG_COMMAND_REQUIRED')

  // 3. Rejection of privateClaimSessionId bypass
  const resRejectClaim = await router.dispatch('workspace/save', {
    cwd,
    sessionId: 'session-B',
    modbus: { privateClaimSessionId: 'evil' },
  })
  assert.equal(resRejectClaim.ok, false)
  assert.equal(resRejectClaim.errorCode, 'CONFIG_COMMAND_REQUIRED')

  // 4. Updating activeConnectionId for session-B preserves session-A on disk
  const resSaveB = await router.dispatch('workspace/save', {
    cwd,
    sessionId: 'session-B',
    modbus: { activeConnectionId: 'conn-B' },
  })
  assert.equal(resSaveB.ok, true)

  const diskWs = loadWorkspace(home, cwd)
  assert.ok(diskWs.modbus.sessionConfigs, 'Disk must maintain sessionConfigs')
  assert.equal(diskWs.modbus.sessionConfigs['session-A'].activeConnectionId, 'conn-A')
  assert.equal(diskWs.modbus.sessionConfigs['session-A'].connections[0].id, 'conn-A')
  assert.equal(diskWs.modbus.sessionConfigs['session-B'].activeConnectionId, 'conn-B')
})
