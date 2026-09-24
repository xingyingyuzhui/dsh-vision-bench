// @ts-check
/**
 * Agent status/list must share a session view without persisting legacy claim;
 * isolation only kicks in after a write-path claim.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { _internal } from '../../host.js'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { createRouter } from '../helpers/rpc-factory.mjs'

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'

test('agent status/list preview legacy topology without disk claim; write claim isolates B', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-scope-status-agent-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        {
          id: 'legacy-c1',
          name: 'Legacy link',
          role: 'client',
          enabled: true,
          conn: { mode: 'tcp', host: '10.0.0.1', sim: true },
        },
      ],
      devices: [{ id: 'legacy-d1', connectionId: 'legacy-c1', name: 'Legacy dev', unitId: 1 }],
      points: [
        {
          id: 'legacy-p1',
          connectionId: 'legacy-c1',
          deviceId: 'legacy-d1',
          name: 'Legacy HR0',
          area: 'holdingRegister',
          function: 3,
          address: 0,
        },
      ],
    },
  })
  _internal.setDshHome(home)
  const router = createRouter(home)
  try {
    const origin = { source: 'agent', sessionId: SESSION_A }
    const before = loadWorkspace(home, cwd)
    const status = await runVisionBench(home, { action: 'status' }, cwd, origin)
    assert.equal(status.ok, true, status.error)
    assert.ok(status.modbus.points.some((/** @type {any} */ p) => p.id === 'legacy-p1'))
    assert.equal(status.configVersion, status.modbus.configVersion)

    const listed = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, origin)
    assert.equal(listed.ok, true, listed.error)
    assert.equal(listed.configVersion, status.configVersion)
    assert.deepEqual(
      listed.points.map((/** @type {any} */ p) => p.id).sort(),
      status.modbus.points.map((/** @type {any} */ p) => p.id).sort(),
    )

    const afterReads = loadWorkspace(home, cwd)
    assert.equal(afterReads.modbus.privateClaimSessionId, before.modbus.privateClaimSessionId || '')
    assert.deepEqual(afterReads.modbus.sessionConfigs || {}, before.modbus.sessionConfigs || {})

    const otherPreview = await runVisionBench(home, { action: 'status' }, cwd, {
      source: 'agent',
      sessionId: SESSION_B,
    })
    assert.equal(otherPreview.ok, true, otherPreview.error)
    assert.ok(otherPreview.modbus.points.some((/** @type {any} */ p) => p.id === 'legacy-p1'))

    const snap = await router.dispatch('state', { cwd, sessionId: SESSION_A }, AbortSignal.timeout(5000))
    assert.equal(snap.ok, true, snap.error)
    assert.equal(loadWorkspace(home, cwd).modbus.privateClaimSessionId, SESSION_A)

    const other = await runVisionBench(home, { action: 'status' }, cwd, {
      source: 'agent',
      sessionId: SESSION_B,
    })
    assert.equal(other.ok, true, other.error)
    assert.deepEqual(other.modbus.points, [])
    assert.ok(!other.modbus.connections.some((/** @type {any} */ c) => c.id === 'legacy-c1'))

    const anon = await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent' })
    assert.equal(anon.ok, false)
    assert.equal(anon.errorCode, ERROR_CODES.SESSION_REQUIRED)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
