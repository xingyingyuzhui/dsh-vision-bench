import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSharedDebugRuntime,
  peekSharedDebugRuntime,
  setSharedDebugRuntime,
} from '../src/application/debug/debug-runtime.mjs'
import {
  dispatchVisionCommand,
  getVisionHost,
  getVisionHostEpoch,
  unregisterVisionHost,
} from '../src/infrastructure/host/vision-host-client.mjs'
import { apply, _internal } from '../host.js'
import { createHostContext, mockRpcHost } from './helpers/rpc-factory.mjs'

async function applyHost() {
  const connection = mockRpcHost()
  const host = createHostContext(connection)
  apply(host.ctx)
  return { connection, ...host }
}

test('host lease: A apply → B apply → A dispose leaves B Fetch/capability/debug intact', async () => {
  unregisterVisionHost()
  setSharedDebugRuntime(null)

  const a = await applyHost()
  const epochA = getVisionHostEpoch()
  const capA = process.env.VISION_BENCH_CAPABILITY
  const runtimeA = peekSharedDebugRuntime()
  assert.ok(epochA)
  assert.ok(capA)
  assert.ok(runtimeA)

  const b = await applyHost()
  const epochB = getVisionHostEpoch()
  const capB = process.env.VISION_BENCH_CAPABILITY
  const runtimeB = peekSharedDebugRuntime()
  assert.ok(epochB)
  assert.notEqual(epochB, epochA)
  assert.ok(capB)
  assert.notEqual(capB, capA)
  assert.equal(runtimeB, runtimeA)
  assert.equal(_internal.getActiveHostLease()?.capability, capB)

  await a.stop()

  assert.equal(process.env.VISION_BENCH_CAPABILITY, capB)
  assert.equal(_internal.capabilityMatches(capB), true)
  assert.equal(peekSharedDebugRuntime(), runtimeB)
  assert.equal(getVisionHostEpoch(), epochB)
  assert.ok(getVisionHost())
  assert.equal(b.connection.fetchDisposed, false)
  assert.equal(b.connection.hasFetchHandler, true)

  const live = await b.connection.invokeFetch('state', {})
  assert.equal(live.status, 200)

  const ping = await dispatchVisionCommand({
    action: 'system.ping',
    cwd: '/tmp/host-lease',
    source: 'agent',
  })
  assert.equal(ping.ok, true, ping.error || ping.errorCode)

  await b.stop()
  assert.equal(process.env.VISION_BENCH_CAPABILITY, undefined)
  assert.equal(peekSharedDebugRuntime(), null)
  assert.equal(getVisionHost(), null)
  assert.equal(_internal.getActiveHostLease(), null)
  assert.equal(b.connection.fetchDisposed, true)
})

test('host lease: clearBridgeCapability is ownership-gated', () => {
  const owned = _internal.issueBridgeCapability()
  assert.equal(_internal.clearBridgeCapability('not-the-owner'), false)
  assert.equal(process.env.VISION_BENCH_CAPABILITY, owned)
  assert.equal(_internal.clearBridgeCapability(owned), true)
  assert.equal(process.env.VISION_BENCH_CAPABILITY, undefined)
})

test('host lease: B dispose clears shared resources; cleanup is idempotent', async () => {
  unregisterVisionHost()
  setSharedDebugRuntime(null)
  const a = await applyHost()
  const b = await applyHost()
  await a.stop()
  await b.stop()
  await b.stop()
  assert.equal(peekSharedDebugRuntime(), null)
  assert.equal(getVisionHost(), null)
  assert.equal(process.env.VISION_BENCH_CAPABILITY, undefined)
  assert.equal(b.connection.fetchDisposed, true)
})

test('host lease: A dispose after B still leaves shared DebugRuntime alive until B stops', async () => {
  unregisterVisionHost()
  setSharedDebugRuntime(null)
  const a = await applyHost()
  const shared = getSharedDebugRuntime()
  const b = await applyHost()
  await a.stop()
  assert.equal(peekSharedDebugRuntime(), shared)
  await b.stop()
  assert.equal(peekSharedDebugRuntime(), null)
})
