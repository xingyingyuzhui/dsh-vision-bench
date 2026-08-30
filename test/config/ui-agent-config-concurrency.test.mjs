import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'
import { createHmiCommandClient } from '../../src/ui/hmi/hmi-command-client.mjs'

function seed(home, cwd) {
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'P1', function: 3, address: 0 }],
    },
  })
}

test('stale UI config command cannot erase a point added by Agent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-ui-agent-'))
  const cwd = join(home, 'board')
  seed(home, cwd)
  const staleVersion = loadWorkspace(home, cwd).modbus.configVersion
  const post = async (path, body) => {
    assert.equal(path, '/dsh-vision-bench/command')
    return executeVisionCommand({ ...body, home })
  }
  const ui = createHmiCommandClient(post, cwd, 'ui-session')
  try {
    const agent = await executeVisionCommand({
      home,
      cwd,
      sessionId: 'agent-session',
      source: 'agent',
      action: 'config',
      payload: {
        operation: 'points.add',
        target: { connectionId: 'c1', deviceId: 'd1' },
        value: { points: [{ id: 'p2', name: 'P2', function: 3, address: 1 }] },
        expectedConfigVersion: staleVersion,
      },
    })
    assert.equal(agent.ok, true, agent.error)

    const staleUi = await ui.mutateConfig(
      'points.update',
      { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      { point: { id: 'p1', name: 'P1 from stale UI' } },
      staleVersion,
    )
    assert.equal(staleUi.ok, false)
    assert.equal(staleUi.errorCode, 'CONFIG_DRIFT')
    assert.deepEqual(
      loadWorkspace(home, cwd).modbus.points.map((point) => point.id),
      ['p1', 'p2'],
    )

    const currentVersion = loadWorkspace(home, cwd).modbus.configVersion
    const freshUi = await ui.mutateConfig(
      'points.update',
      { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      { point: { id: 'p1', name: 'P1 from fresh UI' } },
      currentVersion,
    )
    assert.equal(freshUi.ok, true, freshUi.error)
    const finalPoints = loadWorkspace(home, cwd).modbus.points
    assert.equal(finalPoints.find((point) => point.id === 'p1').name, 'P1 from fresh UI')
    assert.ok(finalPoints.some((point) => point.id === 'p2'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
