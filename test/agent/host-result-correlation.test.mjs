// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOST_DISPATCH_FAILED,
  HOST_INVALID_RESPONSE,
} from '../../src/application/commands/command-contract.mjs'
import { createCommandIdempotencyCache } from '../../src/application/commands/command-idempotency-cache.mjs'
import { visionBenchTool } from '../../src/interfaces/agent/vision-bench-tool.mjs'
import {
  dispatchVisionCommand,
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'

/**
 * @param {any} t
 * @param {any} handle
 */
function withHost(t, handle) {
  unregisterVisionHost()
  const stop = registerVisionHost(handle)
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
}

/**
 * @param {string} cwd
 */
function agentOf(cwd) {
  return { session: { header: { cwd, id: 's1' } } }
}

/**
 * @param {any} result
 */
function assertNoLeak(result) {
  const text = JSON.stringify(result)
  assert.equal(text.includes('stack'), false)
  assert.equal(text.includes('/Users/'), false)
  assert.equal(typeof result.commandId, 'string')
  assert.ok(result.commandId.length > 0)
}

test('in-process sync throw → HOST_DISPATCH_FAILED with commandId; tool path too', async (t) => {
  let calls = 0
  withHost(t, {
    dispatch() {
      calls += 1
      throw new Error('boom secret /Users/qin/secret.key')
    },
  })
  const direct = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-throw-1',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    requireHost: true,
  })
  assert.equal(direct.ok, false)
  assert.equal(direct.errorCode, HOST_DISPATCH_FAILED)
  assert.equal(direct.commandId, 'cmd-throw-1')
  assert.match(String(direct.error), /未能确认本次命令结果/)
  assert.equal(String(direct.error || '').includes('secret'), false)
  assertNoLeak(direct)
  assert.equal(calls, 1)

  const tool = visionBenchTool('/tmp')
  const viaTool = await tool.execute(
    { action: 'status', commandId: 'cmd-throw-2' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(viaTool.ok, false)
  assert.equal(viaTool.errorCode, HOST_DISPATCH_FAILED)
  assert.equal(viaTool.commandId, 'cmd-throw-2')
  assert.equal(calls, 2)
})

test('in-process async reject → HOST_DISPATCH_FAILED', async (t) => {
  withHost(t, {
    async dispatch() {
      await Promise.resolve()
      throw new Error('reject-me')
    },
  })
  const ran = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-reject-1',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, HOST_DISPATCH_FAILED)
  assert.equal(ran.commandId, 'cmd-reject-1')
  assertNoLeak(ran)
})

test('null/undefined/string/array/circular → HOST_INVALID_RESPONSE keeps id', async (t) => {
  const cases = [
    { label: 'null', raw: null },
    { label: 'undefined', raw: undefined },
    { label: 'string', raw: 'nope' },
    { label: 'array', raw: [{ ok: true }] },
  ]
  for (const c of cases) {
    withHost(t, {
      dispatch() {
        return /** @type {any} */ (c.raw)
      },
    })
    const ran = await dispatchVisionCommand({
      action: 'status',
      commandId: `cmd-bad-${c.label}`,
      cwd: '/tmp',
      sessionId: 's1',
      source: 'agent',
    })
    assert.equal(ran.ok, false, c.label)
    assert.equal(ran.errorCode, HOST_INVALID_RESPONSE, c.label)
    assert.equal(ran.commandId, `cmd-bad-${c.label}`, c.label)
  }

  const circular = /** @type {any} */ ({ ok: true })
  circular.self = circular
  withHost(t, {
    dispatch() {
      return circular
    },
  })
  const circ = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-circular',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
  })
  assert.equal(circ.ok, false)
  assert.equal(circ.errorCode, HOST_INVALID_RESPONSE)
  assert.equal(circ.commandId, 'cmd-circular')
})

test('missing commandId filled; mismatched commandId rejected', async (t) => {
  withHost(t, {
    dispatch() {
      return { ok: true, action: 'status', configVersion: 1 }
    },
  })
  const filled = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-fill-1',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
  })
  assert.equal(filled.ok, true)
  assert.equal(filled.commandId, 'cmd-fill-1')

  withHost(t, {
    dispatch() {
      return { ok: true, action: 'status', commandId: 'other-id', configVersion: 1 }
    },
  })
  const mismatch = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-mismatch-1',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
  })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.errorCode, HOST_INVALID_RESPONSE)
  assert.equal(mismatch.reason, 'command-id-mismatch')
  assert.equal(mismatch.commandId, 'cmd-mismatch-1')
  assert.equal(JSON.stringify(mismatch).includes('other-id'), false)
})

test('CONFIG_DRIFT refresh and CONFLICT conflicts survive finishHostResult', async (t) => {
  withHost(t, {
    dispatch(cmd) {
      return {
        ok: false,
        errorCode: 'CONFIG_DRIFT',
        error: 'drift',
        commandId: cmd.commandId,
        refresh: { action: 'points', op: 'list' },
        previousConfigVersion: 2,
        actualVersion: 3,
      }
    },
  })
  const drift = await dispatchVisionCommand({
    action: 'points',
    commandId: 'cmd-drift',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    payload: { action: 'points', op: 'add' },
  })
  assert.equal(drift.errorCode, 'CONFIG_DRIFT')
  assert.equal(drift.commandId, 'cmd-drift')
  assert.deepEqual(drift.refresh, { action: 'points', op: 'list' })

  withHost(t, {
    dispatch(cmd) {
      return {
        ok: false,
        errorCode: 'CONFLICT',
        error: '冲突',
        commandId: cmd.commandId,
        conflicts: [{ deviceId: 'd1' }],
      }
    },
  })
  const conflict = await dispatchVisionCommand({
    action: 'config',
    commandId: 'cmd-conflict',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
  })
  assert.equal(conflict.errorCode, 'CONFLICT')
  assert.deepEqual(conflict.conflicts, [{ deviceId: 'd1' }])
})

test('idempotency cache: rejected executor is not re-run on same commandId', async () => {
  const cache = createCommandIdempotencyCache()
  let executions = 0
  const cmd = {
    home: '/tmp',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    commandId: 'cmd-idem-reject',
    action: 'status',
    payload: { action: 'status' },
  }
  const exec = async () => {
    executions += 1
    throw new Error('executor-boom')
  }
  await assert.rejects(() => cache.run(cmd, exec))
  await assert.rejects(() => cache.run(cmd, exec))
  assert.equal(executions, 1)

  const reuse = await cache.run(
    { ...cmd, action: 'points', payload: { action: 'points', op: 'list' } },
    exec,
  )
  assert.equal(reuse.errorCode, 'COMMAND_ID_REUSE')
  assert.equal(executions, 1)
})
