// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { visionBenchTool } from '../../src/interfaces/agent/vision-bench-tool.mjs'
import {
  HOST_INVALID_RESPONSE,
  HOST_TIMEOUT,
  HOST_UNAVAILABLE,
  COMMAND_ID_REUSE,
} from '../../src/application/commands/command-contract.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { createBench, connection, pointSeries } from '../helpers/workspace-factory.mjs'
import { saveWorkspace } from '../../bench-store.mjs'

/**
 * @param {any} t
 * @param {() => void} [extra]
 */
function withHost(t, handle, extra) {
  unregisterVisionHost()
  const stop = registerVisionHost(handle)
  t.after(() => {
    stop()
    unregisterVisionHost()
    if (extra) extra()
  })
}

/**
 * @param {string} cwd
 * @param {string} [sessionId]
 */
function agentOf(cwd, sessionId = 's1') {
  return { session: { header: { cwd, id: sessionId } } }
}

test('preflight with explicit commandId returns it and never calls Host', async (t) => {
  let hostCalls = 0
  withHost(t, {
    dispatch() {
      hostCalls += 1
      throw new Error('host must not run')
    },
  })
  const tool = visionBenchTool('/tmp')
  const result = await tool.execute(
    { action: 'read', pointId: 'p1', commandId: 'cmd-preflight-1' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'TARGET_REQUIRED')
  assert.equal(result.commandId, 'cmd-preflight-1')
  assert.deepEqual(result.missingFields, ['connectionId', 'deviceId'])
  assert.match(String(result.hint || ''), /connectionId/)
  assert.equal(hostCalls, 0)
})

test('preflight without commandId generates a non-empty id and never calls Host', async (t) => {
  let hostCalls = 0
  withHost(t, {
    dispatch() {
      hostCalls += 1
      throw new Error('host must not run')
    },
  })
  const tool = visionBenchTool('/tmp')
  const result = await tool.execute({ action: 'read', pointId: 'p1' }, { agent: agentOf('/tmp') })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'TARGET_REQUIRED')
  assert.equal(typeof result.commandId, 'string')
  assert.ok(String(result.commandId).length > 0)
  assert.equal(hostCalls, 0)
})

test('aborted signal before Host keeps the same commandId and skips Host', async (t) => {
  let hostCalls = 0
  withHost(t, {
    dispatch() {
      hostCalls += 1
      throw new Error('host must not run')
    },
  })
  const tool = visionBenchTool('/tmp')
  const ac = new AbortController()
  ac.abort()
  const result = await tool.execute(
    { action: 'status', commandId: 'cmd-cancel-1' },
    { agent: agentOf('/tmp'), signal: ac.signal },
  )
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.commandId, 'cmd-cancel-1')
  assert.equal(hostCalls, 0)
})

test('Host unavailable / timeout / invalid response keep the entry commandId', async (t) => {
  unregisterVisionHost()
  t.after(() => unregisterVisionHost())
  const tool = visionBenchTool('/tmp')
  const unavailable = await tool.execute(
    { action: 'status', commandId: 'cmd-unavail' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.errorCode, HOST_UNAVAILABLE)
  assert.equal(unavailable.commandId, 'cmd-unavail')

  withHost(t, {
    async dispatch(cmd) {
      assert.equal(cmd.commandId, 'cmd-timeout')
      return { ok: false, errorCode: HOST_TIMEOUT, error: 'Host 命令超时', commandId: cmd.commandId }
    },
  })
  const timedOut = await tool.execute(
    { action: 'status', commandId: 'cmd-timeout' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(timedOut.errorCode, HOST_TIMEOUT)
  assert.equal(timedOut.commandId, 'cmd-timeout')

  withHost(t, {
    async dispatch(cmd) {
      return {
        ok: false,
        errorCode: HOST_INVALID_RESPONSE,
        error: 'Host 响应无效',
        commandId: cmd.commandId,
      }
    },
  })
  const invalid = await tool.execute(
    { action: 'status', commandId: 'cmd-invalid' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(invalid.errorCode, HOST_INVALID_RESPONSE)
  assert.equal(invalid.commandId, 'cmd-invalid')
})

test('successful Host round-trip keeps one commandId from entry through Host to output', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-cmd-ok-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: pointSeries('hr', 1, { connectionId: 'c1', deviceId: 'd1' }),
    },
  })
  /** @type {string[]} */
  const seen = []
  unregisterVisionHost()
  const real = createVisionCommandDispatcher(home)
  const stop = registerVisionHost({
    async dispatch(cmd) {
      seen.push(String(cmd.commandId || ''))
      return real.dispatch(cmd)
    },
  })
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
  const result = await tool.execute(
    { action: 'status', commandId: 'cmd-success-1' },
    { agent: agentOf(cwd) },
  )
  assert.equal(result.ok, true, result.error)
  assert.equal(result.commandId, 'cmd-success-1')
  assert.deepEqual(seen, ['cmd-success-1'])
})

test('Host CONFIG_DRIFT keeps commandId and refresh fields', async (t) => {
  withHost(t, {
    async dispatch(cmd) {
      return {
        ok: false,
        errorCode: 'CONFIG_DRIFT',
        error: '配置已变更',
        previousConfigVersion: 3,
        actualVersion: 4,
        commandId: cmd.commandId,
      }
    },
  })
  const tool = visionBenchTool('/tmp')
  const result = await tool.execute(
    {
      action: 'points',
      op: 'add',
      expectedConfigVersion: 3,
      point: { name: 'x', function: 3, address: 0, connectionId: 'c1', deviceId: 'd1' },
      commandId: 'cmd-drift-1',
    },
    { agent: agentOf('/tmp') },
  )
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'CONFIG_DRIFT')
  assert.equal(result.commandId, 'cmd-drift-1')
  assert.ok(result.refresh && typeof result.refresh === 'object')
  assert.equal(result.previousConfigVersion, 3)
})

test('Host CONFLICT keeps commandId and conflicts', async (t) => {
  withHost(t, {
    async dispatch(cmd) {
      return {
        ok: false,
        errorCode: 'CONFLICT',
        error: '设备冲突',
        conflicts: [{ deviceId: 'd1', layer: 'shared' }],
        commandId: cmd.commandId,
      }
    },
  })
  const tool = visionBenchTool('/tmp')
  const result = await tool.execute(
    { action: 'config', operation: 'device.create', expectedConfigVersion: 1, commandId: 'cmd-conflict-1' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'CONFLICT')
  assert.equal(result.commandId, 'cmd-conflict-1')
  assert.deepEqual(result.conflicts, [{ deviceId: 'd1', layer: 'shared' }])
})

test('same commandId replay and COMMAND_ID_REUSE keep existing idempotency behavior', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-cmd-idem-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
  const agent = agentOf(cwd)
  const first = await tool.execute({ action: 'status', commandId: 'cmd-idem-1' }, { agent })
  assert.equal(first.ok, true, first.error)
  assert.equal(first.commandId, 'cmd-idem-1')
  const replay = await tool.execute({ action: 'status', commandId: 'cmd-idem-1' }, { agent })
  assert.equal(replay.ok, true, replay.error)
  assert.equal(replay.commandId, 'cmd-idem-1')
  assert.equal(replay.idempotent, true)

  const reused = await tool.execute(
    { action: 'points', op: 'list', commandId: 'cmd-idem-1' },
    { agent },
  )
  assert.equal(reused.ok, false)
  assert.equal(reused.errorCode, COMMAND_ID_REUSE)
  assert.equal(reused.commandId, 'cmd-idem-1')
})
