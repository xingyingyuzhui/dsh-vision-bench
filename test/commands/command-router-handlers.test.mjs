import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../../src/application/commands/vision-command-router.mjs'
import { executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function seed(home, cwd) {
  mkdirSync(cwd, { recursive: true })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 },
      ],
      points: [
        { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'Temp', function: 3, address: 0, monitorEnabled: true },
      ],
    },
  })
}

test('router maps unknown action and removed draft without handler details', async () => {
  const unknown = await runVisionBench('/tmp', { action: 'not-a-thing' }, '/tmp/x', {}, {})
  assert.equal(unknown.ok, false)
  assert.equal(unknown.errorCode, 'UNKNOWN_ACTION')
  const draft = await runVisionBench('/tmp', { action: 'draft' }, '/tmp/x', {}, {})
  assert.equal(draft.errorCode, 'OP_REMOVED')
})

test('system.ping is routed before workspace checks', async () => {
  const ran = await runVisionBench('', { action: 'system.ping' }, '', { source: 'system' }, {})
  assert.equal(ran.ok, true)
  assert.equal(ran.data.service, 'dsh-vision-bench')
  assert.equal(typeof ran.data.pid, 'number')
})

test('project/config/visualization handlers cover happy and mismatch paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-router-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  try {
    const status = await executeVisionCommand({ home, cwd, action: 'status', source: 'user', sessionId: 's1' })
    assert.equal(status.ok, true)
    assert.equal(status.cwd, cwd)
    assert.equal(status.session.sessionId, 's1')

    const mismatch = await executeVisionCommand({
      home,
      cwd,
      action: 'points',
      source: 'agent',
      payload: {
        action: 'points',
        op: 'update',
        connectionId: 'c1',
        deviceId: 'd2',
        pointId: 'p1',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        point: { id: 'p1', name: 'Nope' },
      },
    })
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.errorCode, 'TARGET_MISMATCH')

    const drift = await executeVisionCommand({
      home,
      cwd,
      action: 'points',
      source: 'agent',
      payload: {
        action: 'points',
        op: 'add',
        connectionId: 'c1',
        deviceId: 'd1',
        expectedConfigVersion: 999,
        point: { name: 'X', function: 3, address: 9 },
      },
    })
    assert.equal(drift.ok, false)
    assert.equal(drift.errorCode, 'CONFIG_DRIFT')

    const viz = await executeVisionCommand({
      home,
      cwd,
      action: 'visualization',
      source: 'agent',
      payload: {
        action: 'visualization',
        op: 'add',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        component: { name: 'Gauge', type: 'value', pointIds: ['p1'] },
      },
    })
    assert.equal(viz.ok, true, viz.error)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('router is a composition layer and handlers own business branches', () => {
  const router = readFileSync(join(root, 'src/application/commands/vision-command-router.mjs'), 'utf8')
  const lines = router.split('\n').length
  assert.ok(lines <= 260, `router too large: ${lines}`)
  assert.match(router, /handleConfigCommand/)
  assert.match(router, /handleProjectCommand/)
  assert.match(router, /handleLiveCommand/)
  assert.match(router, /handleVisualizationCommand/)
  assert.match(router, /handleEvidenceCommand/)
  assert.match(router, /handleSystemCommand/)
  assert.doesNotMatch(router, /mutateConfig\(/)
  assert.doesNotMatch(router, /modbusWrite\(/)
})
