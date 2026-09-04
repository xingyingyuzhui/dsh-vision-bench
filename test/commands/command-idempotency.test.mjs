import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { _internal, executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'
import { projectModbusForSession } from '../../src/application/modbus/config-scope-service.mjs'

function sessionPack(home, cwd, sessionId) {
  return projectModbusForSession(loadWorkspace(home, cwd).modbus, sessionId)
}

function seed(home, cwd, name, sessionIds = ['s1', 's2']) {
  mkdirSync(cwd, { recursive: true })
  const connections = [{ id: 'c1', name, conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }]
  const devices = [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }]
  const slice = {
    connections,
    devices,
    points: [],
    visualization: null,
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
  /** @type {Record<string, typeof slice>} */
  const sessionConfigs = {}
  for (const id of sessionIds) {
    sessionConfigs[id] = {
      ...slice,
      connections: connections.map((c) => ({ ...c })),
      devices: devices.map((d) => ({ ...d })),
      points: [],
    }
  }
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      privateClaimSessionId: sessionIds[0],
      connections: [],
      devices: [],
      points: [],
      sessionConfigs,
    },
  })
}

const addPoint = (home, cwd, sessionId, commandId, address) =>
  executeVisionCommand({
    home,
    cwd,
    sessionId,
    source: 'agent',
    commandId,
    action: 'points',
    payload: {
      action: 'points',
      op: 'add',
      connectionId: 'c1',
      deviceId: 'd1',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      point: { name: `P${address}`, function: 3, address },
    },
  })

test('same commandId is scoped by workspace and session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-idemp-'))
  const a = join(home, 'a')
  const b = join(home, 'b')
  seed(home, a, 'A')
  seed(home, b, 'B')
  const r1 = await addPoint(home, a, 's1', 'cmd-shared', 1)
  const r2 = await addPoint(home, b, 's1', 'cmd-shared', 2)
  assert.equal(r1.ok, true, r1.error)
  assert.equal(r2.ok, true, r2.error)
  assert.equal(sessionPack(home, a, 's1').points.length, 1)
  assert.equal(sessionPack(home, b, 's1').points.length, 1)
  const r3 = await addPoint(home, a, 's2', 'cmd-shared', 3)
  assert.equal(r3.ok, true, r3.error)
  assert.equal(sessionPack(home, a, 's1').points.length, 1)
  assert.equal(sessionPack(home, a, 's2').points.length, 1)
  await rm(home, { recursive: true, force: true })
})

test('duplicate command in the same scope runs once even when concurrent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-idemp2-'))
  const cwd = join(home, 'board')
  seed(home, cwd, 'C1')
  const cv = loadWorkspace(home, cwd).modbus.configVersion
  const mk = () =>
    executeVisionCommand({
      home,
      cwd,
      sessionId: 's1',
      source: 'agent',
      commandId: 'cmd-once',
      action: 'points',
      expectedConfigVersion: cv,
      payload: {
        action: 'points',
        op: 'add',
        connectionId: 'c1',
        deviceId: 'd1',
        expectedConfigVersion: cv,
        point: { name: 'Once', function: 3, address: 8 },
      },
    })
  const [a, b] = await Promise.all([mk(), mk()])
  assert.equal(a.ok, true, a.error)
  assert.equal(b.ok, true, b.error)
  assert.equal(sessionPack(home, cwd, 's1').points.length, 1)
  await rm(home, { recursive: true, force: true })
})

test('reusing commandId with a different payload returns COMMAND_ID_REUSE', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-idemp3-'))
  const cwd = join(home, 'board')
  seed(home, cwd, 'C1')
  const first = await addPoint(home, cwd, 's1', 'cmd-reuse', 1)
  assert.equal(first.ok, true, first.error)
  const second = await addPoint(home, cwd, 's1', 'cmd-reuse', 9)
  assert.equal(second.ok, false)
  assert.equal(second.errorCode, 'COMMAND_ID_REUSE')
  assert.equal(sessionPack(home, cwd, 's1').points.length, 1)
  await rm(home, { recursive: true, force: true })
})

test('WRITE_OUTCOME_UNKNOWN is cached and not retried', async () => {
  const { createCommandIdempotencyCache } = await import('../../src/application/commands/command-idempotency-cache.mjs')
  const cache = createCommandIdempotencyCache({ ttlMs: 60_000, maxEntries: 10 })
  const cmd = {
    home: '/tmp',
    cwd: '/tmp/ws',
    sessionId: 's1',
    source: 'agent',
    commandId: 'w1',
    action: 'write',
    payload: { address: 1, values: [1] },
  }
  let runs = 0
  const run = () =>
    cache.run(cmd, async () => {
      runs += 1
      return { ok: false, errorCode: 'WRITE_OUTCOME_UNKNOWN', error: 'unknown' }
    })
  const a = await run()
  const b = await run()
  assert.equal(runs, 1)
  assert.equal(a.errorCode, 'WRITE_OUTCOME_UNKNOWN')
  assert.equal(b.errorCode, 'WRITE_OUTCOME_UNKNOWN')
  assert.equal(b.idempotent, true)
  void _internal
})
