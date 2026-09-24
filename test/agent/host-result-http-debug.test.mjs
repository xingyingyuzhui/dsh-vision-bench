// @ts-check
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  HOST_DISPATCH_FAILED,
  HOST_INVALID_RESPONSE,
  HOST_UNAVAILABLE,
} from '../../src/application/commands/command-contract.mjs'
import { visionDebugTool } from '../../src/interfaces/agent/vision-debug-tool.mjs'
import {
  dispatchVisionCommand,
  dispatchVisionDebugCommand,
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

test('abort before dispatch returns cancelled with id; Host unavailable keeps id', async (t) => {
  let calls = 0
  withHost(t, {
    dispatch() {
      calls += 1
      return { ok: true, action: 'status' }
    },
  })
  const ac = new AbortController()
  ac.abort()
  const cancelled = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-cancel',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    signal: ac.signal,
  })
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.commandId, 'cmd-cancel')
  assert.equal(calls, 0)

  unregisterVisionHost()
  t.after(() => unregisterVisionHost())
  const missing = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-unavail',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    requireHost: true,
  })
  assert.equal(missing.errorCode, HOST_UNAVAILABLE)
  assert.equal(missing.commandId, 'cmd-unavail')
})

test('HTTP invalid JSON keeps HOST_INVALID_RESPONSE and commandId', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('not-json{')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address())
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = `http://127.0.0.1:${addr.port}`
  t.after(() => {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
  })
  unregisterVisionHost()
  const ran = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-http-bad',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    requireHost: true,
    timeoutMs: 2000,
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, HOST_INVALID_RESPONSE)
  assert.equal(ran.commandId, 'cmd-http-bad')
})

test('HTTP empty object without ok → HOST_INVALID_RESPONSE', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ commandId: 'cmd-http-empty' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address())
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = `http://127.0.0.1:${addr.port}`
  t.after(() => {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
  })
  unregisterVisionHost()
  const ran = await dispatchVisionCommand({
    action: 'status',
    commandId: 'cmd-http-empty',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
    requireHost: true,
    timeoutMs: 2000,
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, HOST_INVALID_RESPONSE)
  assert.equal(ran.commandId, 'cmd-http-empty')
})

test('vision_debug through shared client keeps debug action and commandId on failure', async (t) => {
  withHost(t, {
    dispatch() {
      throw new Error('debug-boom')
    },
  })
  const ran = await dispatchVisionDebugCommand({
    action: 'status',
    commandId: 'cmd-debug-1',
    cwd: '/tmp',
    sessionId: 's1',
    source: 'agent',
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, HOST_DISPATCH_FAILED)
  assert.equal(ran.commandId, 'cmd-debug-1')
  assert.equal(ran.action, 'debug.status')

  const tool = visionDebugTool('/tmp')
  const via = await tool.execute(
    { action: 'status', commandId: 'cmd-debug-2' },
    { agent: agentOf('/tmp') },
  )
  assert.equal(via.commandId, 'cmd-debug-2')
  assert.equal(via.ok, false)
  assert.equal(via.errorCode, HOST_DISPATCH_FAILED)
})
