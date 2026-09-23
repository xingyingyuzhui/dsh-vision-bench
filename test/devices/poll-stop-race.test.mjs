import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import {
  ensurePolling,
  pollingStatus,
  resetPollingService,
  startPolling,
  stopAllPolling,
  stopPolling,
} from '../../bench-polling-service.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

/**
 * @returns {{
 *   transport: { read: () => Promise<any> },
 *   started: Promise<void>,
 *   release: () => void,
 * }}
 */
function hangingRead() {
  /** @type {(value?: unknown) => void} */
  let releaseGate = () => {}
  /** @type {() => void} */
  let markStarted = () => {}
  let opened = false
  const gate = new Promise((resolve) => {
    releaseGate = resolve
  })
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  return {
    transport: {
      read: async () => {
        if (!opened) {
          opened = true
          markStarted()
        }
        await gate
        return { ok: true, data: [1] }
      },
    },
    started,
    release: () => releaseGate(),
  }
}

/**
 * @param {import('node:test').TestContext} t
 * @param {string} prefix
 * @param {Record<string, any>} [pollingByConnection]
 */
async function seed(t, prefix, pollingByConnection) {
  const bench = await createBench(t, { prefix })
  bench.save({
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3', { name: 'C1' }), rtuSim('c2', 'COM4', { name: 'C2' })],
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 1, 'D2')],
      points: [
        hrPoint('p1', 'c1', 'd1', 0, { monitorEnabled: true }),
        hrPoint('p2', 'c2', 'd2', 0, { monitorEnabled: true }),
      ],
      values: [],
      pollingByConnection: pollingByConnection || {
        c1: { enabled: true, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' },
        c2: { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' },
      },
    },
  })
  return bench
}

/**
 * @param {ReturnType<typeof hangingRead>} gate
 * @param {string} home
 * @param {string} cwd
 */
function pollWhileHung(gate, home, cwd) {
  const pending = modbusPoll(home, cwd, { connectionId: 'c1', transport: gate.transport })
  return pending
}

test('in-flight poll commit does not undo stopPolling', async (t) => {
  t.after(() => {
    stopAllPolling()
    resetPollingService()
  })
  const bench = await seed(t, 'dvb-poll-stop-')
  const { home, cwd } = bench
  const gate = hangingRead()
  const pending = pollWhileHung(gate, home, cwd)
  const winner = await Promise.race([
    gate.started.then(() => 'hung'),
    pending.then((result) => result),
  ])
  assert.equal(winner, 'hung', `poll returned before the read hung: ${JSON.stringify(winner)}`)
  try {
    const stopped = await stopPolling(home, cwd, { connectionId: 'c1' })
    assert.equal(stopped.ok, true, stopped.error)
    assert.equal(stopped.enabled, false)
    assert.equal(loadWorkspace(home, cwd).modbus.pollingByConnection.c1.enabled, false)
    gate.release()
    const ran = await pending
    assert.equal(ran.ok, true, ran.error)
    const row = loadWorkspace(home, cwd).modbus.pollingByConnection.c1
    assert.equal(row.enabled, false, 'stop must survive the in-flight tick commit')
    assert.equal(row.intervalMs, 1000)
    assert.ok(row.lastAt > 0, 'runtime stamp still lands')
    ensurePolling(home, cwd)
    assert.equal(pollingStatus(home, cwd).connections.c1.running, false, 'coordinator must not restart a stopped connection')
  } finally {
    gate.release()
  }
})

test('in-flight poll commit keeps an intervalMs change', async (t) => {
  t.after(() => {
    stopAllPolling()
    resetPollingService()
  })
  const bench = await seed(t, 'dvb-poll-interval-')
  const { home, cwd } = bench
  const gate = hangingRead()
  const pending = pollWhileHung(gate, home, cwd)
  const winner = await Promise.race([
    gate.started.then(() => 'hung'),
    pending.then((result) => result),
  ])
  assert.equal(winner, 'hung', `poll returned before the read hung: ${JSON.stringify(winner)}`)
  try {
    const started = await startPolling(home, cwd, { connectionId: 'c1', intervalMs: 2500 })
    assert.equal(started.ok, true, started.error)
    assert.equal(started.intervalMs, 2500)
    stopAllPolling()
    gate.release()
    const ran = await pending
    assert.equal(ran.ok, true, ran.error)
    const row = loadWorkspace(home, cwd).modbus.pollingByConnection.c1
    assert.equal(row.intervalMs, 2500, 'interval written during the tick must survive the commit')
    assert.equal(row.enabled, true)
    assert.ok(row.lastAt > 0)
  } finally {
    gate.release()
  }
})

test('in-flight poll commit does not resurrect a deleted connection', async (t) => {
  t.after(() => {
    stopAllPolling()
    resetPollingService()
  })
  const bench = await seed(t, 'dvb-poll-delete-')
  const { home, cwd } = bench
  const gate = hangingRead()
  const pending = pollWhileHung(gate, home, cwd)
  const winner = await Promise.race([
    gate.started.then(() => 'hung'),
    pending.then((result) => result),
  ])
  assert.equal(winner, 'hung', `poll returned before the read hung: ${JSON.stringify(winner)}`)
  try {
    const removed = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      operation: 'connection.remove',
      target: { connectionId: 'c1' },
      value: {},
    })
    assert.equal(removed.ok, true, removed.error)
    const mid = loadWorkspace(home, cwd).modbus
    assert.equal(mid.connections.some((/** @type {any} */ c) => c.id === 'c1' && !c.__synthesized), false)
    assert.equal(mid.pollingByConnection.c1, undefined)
    gate.release()
    await pending
    const after = loadWorkspace(home, cwd).modbus
    assert.equal(
      after.connections.some((/** @type {any} */ c) => c.id === 'c1' && !c.__synthesized),
      false,
    )
    assert.equal(after.pollingByConnection.c1, undefined, 'deleted connection polling row must not come back')
    assert.equal(after.pollingByConnection.c2.enabled, false)
    assert.equal(after.pollingByConnection.c2.intervalMs, 1000)
  } finally {
    gate.release()
  }
})
