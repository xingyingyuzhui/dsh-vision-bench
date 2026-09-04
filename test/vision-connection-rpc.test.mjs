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

test('createVisionRpcPost resolves structured business failures', async () => {
  const cases = [
    { ok: false, error: 'denied', errorCode: 'CONFIG_DRIFT' },
    { ok: false, needsConfirm: true, request: { requestId: 'r1' } },
    { ok: false, rejected: true },
  ]
  for (const value of cases) {
    const post = createVisionRpcPost({
      rpc: {
        async call() {
          return { ok: true, value }
        },
      },
    })
    const data = await post('/dsh-vision-bench/state', {})
    assert.deepEqual(data, value)
  }
})

test('createVisionRpcPost rejects outer RPC transport failures', async () => {
  const post = createVisionRpcPost({
    rpc: {
      async call() {
        return { ok: false, error: { code: 'forbidden', message: 'unauthenticated', details: {} } }
      },
    },
  })
  await assert.rejects(() => post('/dsh-vision-bench/state', {}), /unauthenticated/)
})

test('createVisionRpcPost rejects unknown paths before calling RPC', async () => {
  let called = 0
  const post = createVisionRpcPost({
    rpc: {
      async call() {
        called += 1
        return { ok: true, value: { ok: true } }
      },
    },
  })
  assert.throws(() => post('/dsh-vision-bench/no-such', {}), /unknown RPC path/)
  assert.equal(called, 0)
})

test('flash start via RPC post resolves needsConfirm into confirm card state', async () => {
  const post = createVisionRpcPost({
    rpc: {
      async call(_ch, endpoint) {
        if (endpoint === 'keil/download') {
          return {
            ok: true,
            value: {
              ok: false,
              needsConfirm: true,
              request: { requestId: 'flash-1', file: 'app.bin', size: 12 },
              error: '烧录会改写设备 Flash，需要用户确认',
            },
          }
        }
        return { ok: true, value: { ok: true } }
      },
    },
  })
  let flash = { busy: true, confirm: null, result: null }
  const setFlash = (fn) => {
    flash = typeof fn === 'function' ? fn(flash) : fn
  }
  const data = await post('/dsh-vision-bench/keil/download', { cwd: '/ws' }, 20000)
  if (data && data.needsConfirm) {
    setFlash((prev) => ({ ...prev, busy: false, confirm: data.request }))
  } else {
    setFlash((prev) => ({
      ...prev,
      busy: false,
      confirm: null,
      result: { ok: false, error: 'should not enter failure branch' },
    }))
  }
  assert.equal(flash.busy, false)
  assert.equal(flash.confirm?.requestId, 'flash-1')
  assert.equal(flash.result, null)
})

test('points/flags CONFIG_DRIFT via RPC post remains structured for retry', async () => {
  let calls = 0
  const post = createVisionRpcPost({
    rpc: {
      async call(_ch, endpoint, payload) {
        calls += 1
        if (endpoint === 'points/flags') {
          if (payload.expectedConfigVersion === 10) {
            return { ok: true, value: { ok: false, errorCode: 'CONFIG_DRIFT', error: '点位配置已更新，请刷新后重试' } }
          }
          return {
            ok: true,
            value: {
              ok: true,
              point: { id: 'p1', monitorEnabled: true },
              configVersion: 11,
            },
          }
        }
        if (endpoint === 'state') {
          return { ok: true, value: { ok: true, workspace: { modbus: { configVersion: 11 } } } }
        }
        return { ok: true, value: { ok: true } }
      },
    },
  })
  const first = await post('/dsh-vision-bench/points/flags', {
    cwd: '/ws',
    pointId: 'p1',
    monitorEnabled: true,
    expectedConfigVersion: 10,
  })
  assert.equal(first.ok, false)
  assert.equal(first.errorCode, 'CONFIG_DRIFT')
  const fresh = await post('/dsh-vision-bench/state', { cwd: '/ws' })
  const second = await post('/dsh-vision-bench/points/flags', {
    cwd: '/ws',
    pointId: 'p1',
    monitorEnabled: true,
    expectedConfigVersion: fresh.workspace.modbus.configVersion,
  })
  assert.equal(second.ok, true)
  assert.equal(second.point.monitorEnabled, true)
  assert.equal(calls, 3)
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
    assert.deepEqual(snap.globalShare, {
      enabled: false,
      connections: false,
      points: false,
      visualization: false,
    })
    const missing = await router.dispatch('missing/endpoint', {}, AbortSignal.timeout(5000))
    assert.equal(missing.ok, false)
    assert.equal(missing.errorCode, 'NOT_FOUND')

    // Test saving global share without cwd
    const saved = await router.dispatch(
      'bindings/save',
      {
        bindings: { python: '', uv4: '', openocd: '' },
        share: { enabled: true, connections: true, points: true, visualization: false },
      },
      AbortSignal.timeout(5000),
    )
    assert.equal(saved.ok, true)
    assert.equal(saved.globalShare.enabled, true)
    assert.equal(saved.globalShare.connections, true)

    // Verify state without cwd reflects updated globalShare
    const snapNoCwd = await router.dispatch('state', {}, AbortSignal.timeout(5000))
    assert.equal(snapNoCwd.ok, true)
    assert.equal(snapNoCwd.globalShare.enabled, true)
    assert.equal(snapNoCwd.globalShare.connections, true)
    assert.equal(snapNoCwd.globalShare.points, true)
    assert.equal(snapNoCwd.globalShare.visualization, false)
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
