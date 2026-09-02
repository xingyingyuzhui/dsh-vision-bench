import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply as applyRuntime } from '../bench-runtime.mjs'
import { _internal, apply as applyHost } from '../host.js'
import { callVisionRpc, createVisionRpcPost } from '../src/infrastructure/host/vision-rpc-client.mjs'
import { createVisionRpcRouter } from '../src/interfaces/rpc/vision-rpc-router.mjs'
import {
  VISION_HTTP_TO_RPC,
  VISION_RPC_CHANNEL,
  VISION_RPC_ENDPOINTS,
  httpPathToRpcEndpoint,
} from '../src/shared/vision-rpc-contract.mjs'

function mockRpcClient() {
  const calls = []
  return {
    calls,
    connection: {
      rpc: {
        async call(channel, endpoint, payload, signal) {
          calls.push({ channel, endpoint, payload, signal })
          return { ok: true, value: { ok: true, endpoint, payload } }
        },
      },
    },
  }
}

test('contract maps every browser path to a stable endpoint', () => {
  assert.equal(httpPathToRpcEndpoint('/dsh-vision-bench/state'), 'state')
  assert.equal(httpPathToRpcEndpoint('/dsh-vision-bench/modbus/write/approve'), 'modbus/write/approve')
  assert.equal(httpPathToRpcEndpoint('/dsh-vision-bench/command'), 'command')
  assert.ok(VISION_RPC_ENDPOINTS.includes('selfcheck'))
  assert.equal(Object.keys(VISION_HTTP_TO_RPC).length, VISION_RPC_ENDPOINTS.length)
})

test('createVisionRpcPost rejects missing connection.rpc.call', () => {
  assert.throws(() => createVisionRpcPost(null), /connection\.rpc\.call/)
})

test('createVisionRpcPost maps path and unwraps rpc result', async () => {
  const mock = mockRpcClient()
  const post = createVisionRpcPost(mock.connection)
  const data = await post('/dsh-vision-bench/state', { cwd: '/tmp/ws' }, 3000)
  assert.equal(data.ok, true)
  assert.equal(mock.calls[0].channel, VISION_RPC_CHANNEL)
  assert.equal(mock.calls[0].endpoint, 'state')
})

test('createVisionRpcPost surfaces business failures', async () => {
  const post = createVisionRpcPost({
    rpc: {
      async call() {
        return { ok: true, value: { ok: false, error: 'denied' } }
      },
    },
  })
  await assert.rejects(() => post('/dsh-vision-bench/state', {}), /denied/)
})

test('bench-runtime apply fails closed without connection', () => {
  assert.throws(
    () =>
      applyRuntime({
        slots: {},
        locale: { register: () => () => {} },
      }),
    /connection\.rpc\.call/,
  )
})

test('host apply fails closed without connection.rpc.handle', () => {
  assert.throws(
    () =>
      applyHost({
        webServer: { register: () => () => {} },
        tools: { register: () => () => {} },
        effect() {},
      }),
    /connection\.rpc\.handle/,
  )
})

test('router dispatch serves state and rejects unknown endpoints', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-rpc-router-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  _internal.setDshHome(home)
  const router = createVisionRpcRouter({ getHome: () => home })
  try {
    const snap = await router.dispatch('state', { cwd }, AbortSignal.timeout(5000))
    assert.equal(snap.ok, true)
    const missing = await router.dispatch('missing/endpoint', {}, AbortSignal.timeout(5000))
    assert.equal(missing.ok, false)
    assert.equal(missing.errorCode, 'NOT_FOUND')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('callVisionRpc propagates transport failures', async () => {
  await assert.rejects(
    () =>
      callVisionRpc(
        {
          rpc: {
            async call() {
              return { ok: false, error: { code: 'forbidden', message: 'unauthenticated', details: {} } }
            },
          },
        },
        'state',
      ),
    /unauthenticated/,
  )
})
