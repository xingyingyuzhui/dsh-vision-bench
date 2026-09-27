// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { listFrames } from '../../bench-modbus.mjs'
import { loadWorkspace, workspaceKey } from '../../bench-store.mjs'
import { workspaceDir } from '../../src/infrastructure/persistence/workspace-migration.mjs'
import { ensureWorkspaceClaimed } from '../../src/application/modbus/workspace-session-view.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { agentDevice, agentRtu } from './ui-fixtures.mjs'

test('frames list and frameId lookup do not persist a legacy claim', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-frames-readonly-' })
  const { home, cwd } = bench
  const now = Date.now()
  bench.save({
    modbus: {
      version: 3,
      configVersion: 3,
      connections: [agentRtu('c1', 'COM3', { name: 'C1' })],
      devices: [agentDevice('d1', 'c1')],
      points: [],
      framesByConnection: {
        c1: [{ id: 'f1', frameId: 'f1', connectionId: 'c1', t: now, dir: 'rx', data: [1, 2] }],
      },
    },
  })
  const dir = workspaceDir(home, workspaceKey(cwd))
  const beforeConfig = readFileSync(join(dir, 'config.json'))
  const beforeRuntime = readFileSync(join(dir, 'runtime.json'))
  const before = loadWorkspace(home, cwd)
  const listed = listFrames(home, cwd, { source: 'agent', sessionId: 'session-a', connectionId: 'c1' })
  assert.equal(listed.ok, true, listed.error)
  assert.equal(listed.total, 1)
  const one = listFrames(home, cwd, {
    source: 'agent',
    sessionId: 'session-a',
    connectionId: 'c1',
    frameId: 'f1',
  })
  assert.equal(one.ok, true, one.error)
  assert.equal(one.frame.id, 'f1')
  assert.deepEqual(readFileSync(join(dir, 'config.json')), beforeConfig)
  assert.deepEqual(readFileSync(join(dir, 'runtime.json')), beforeRuntime)
  assert.equal(loadWorkspace(home, cwd).modbus.configVersion, before.modbus.configVersion)
  assert.equal(loadWorkspace(home, cwd).modbus.privateClaimSessionId || '', '')

  await ensureWorkspaceClaimed(home, cwd, 'session-b')
  const after = loadWorkspace(home, cwd)
  assert.equal(after.modbus.privateClaimSessionId, 'session-b')
  assert.ok(after.modbus.sessionConfigs?.['session-b'])
  assert.equal(after.modbus.sessionConfigs?.['session-a'], undefined)
})

test('partitioned frames without a session is SESSION_REQUIRED', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-frames-session-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      configVersion: 2,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [agentRtu('c1', 'COM3')],
          devices: [agentDevice('d1', 'c1')],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
  })
  const missing = await runVisionBench(home, { action: 'frames', connectionId: 'c1' }, cwd, {
    source: 'agent',
    sessionId: '',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'SESSION_REQUIRED')
})
