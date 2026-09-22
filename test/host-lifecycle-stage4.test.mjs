import assert from 'node:assert/strict'
import test from 'node:test'
import { HOST_UNAVAILABLE } from '../src/application/commands/command-contract.mjs'
import {
  getSharedDebugRuntime,
  peekSharedDebugRuntime,
  setSharedDebugRuntime,
} from '../src/application/debug/debug-runtime.mjs'
import {
  dispatchVisionCommand,
  getVisionHostEpoch,
  unregisterVisionHost,
} from '../src/infrastructure/host/vision-host-client.mjs'
import { apply } from '../host.js'
import { createHostContext, mockRpcHost } from './helpers/rpc-factory.mjs'

test('stage4: dispose clears Fetch route and Host handle; re-apply restores', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  assert.ok(connection.hasFetchHandler)
  const epoch = getVisionHostEpoch()
  assert.ok(epoch)

  const live = await connection.invokeFetch('state', {})
  assert.equal(live.status, 200)

  await stop()
  assert.equal(connection.fetchDisposed, true)
  assert.equal(connection.hasFetchHandler, false)

  const missing = await dispatchVisionCommand({
    action: 'status',
    cwd: '/tmp/stage4',
    source: 'agent',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, HOST_UNAVAILABLE)

  const connection2 = mockRpcHost()
  const second = createHostContext(connection2)
  apply(second.ctx)
  assert.ok(connection2.hasFetchHandler)
  assert.notEqual(getVisionHostEpoch(), epoch)
  const again = await connection2.invokeFetch('state', {})
  assert.equal(again.status, 200)
  await second.stop()
  assert.equal(connection2.fetchDisposed, true)
})

test('stage4: host dispose clears shared DebugRuntime', async () => {
  unregisterVisionHost()
  setSharedDebugRuntime(null)
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  assert.ok(peekSharedDebugRuntime())
  assert.equal(peekSharedDebugRuntime(), getSharedDebugRuntime())
  await stop()
  assert.equal(peekSharedDebugRuntime(), null)
})

test('stage4: host dispose is idempotent', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  await stop()
  await stop()
  assert.equal(connection.fetchDisposed, true)
})

test('stage4: late Fetch disposer after fiber stop still runs', async () => {
  unregisterVisionHost()
  let resolveReg
  const registration = new Promise((resolve) => {
    resolveReg = resolve
  })
  let disposeCalls = 0
  const connection = mockRpcHost()
  connection.fetch.register = (route) => {
    if (!route || typeof route.fetch !== 'function') throw new Error('invalid fetch route')
    return registration
  }
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  const stopping = Promise.resolve(stop())
  resolveReg(() => {
    disposeCalls += 1
  })
  await stopping
  assert.ok(disposeCalls >= 1, 'late Fetch disposer must run')
})
