import assert from 'node:assert/strict'
import test from 'node:test'
import { unregisterVisionHost } from '../../src/infrastructure/host/vision-host-client.mjs'
import { apply } from '../../host.js'
import { createHostContext, mockRpcHost } from '../helpers/rpc-factory.mjs'
import { mountVisionWebCompat } from '../../src/interfaces/web/vision-web-compat.mjs'
import { VISION_RPC_CHANNEL } from '../../src/shared/vision-rpc-contract.mjs'

test('web compat: webServer activate registers command route and RPC', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const { ctx, routes, stop } = createHostContext(connection)
  apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/dsh-vision-bench/command')
  assert.equal(connection.hasHandler, true)
  assert.equal(connection.hasFetchHandler, true)
  await stop()
  assert.equal(routes.length, 0)
  assert.equal(connection.disposed, true)
})

test('web compat: unloading inject sub-fiber drops route and RPC; Fetch Host stays', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const host = createHostContext(connection)
  apply(host.ctx)
  assert.equal(host.routes.length, 1)
  assert.equal(connection.hasHandler, true)

  await host.stopWebInjects()
  assert.equal(host.routes.length, 0)
  assert.equal(connection.disposed, true)
  assert.equal(connection.hasFetchHandler, true)

  const live = await connection.invokeFetch('state', {})
  assert.equal(live.status, 200)
  await host.stop()
})

test('web compat: re-activate webServer remounts without duplicate routes', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const host = createHostContext(connection)
  apply(host.ctx)
  await host.stopWebInjects()
  assert.equal(host.routes.length, 0)

  // Simulate Cordis re-injecting webServer while Host fiber stays up.
  host.ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const compat = mountVisionWebCompat({
        connection,
        webServer: host.ctx.webServer,
        router: {
          dispatch: async () => ({ ok: true }),
        },
        dshHome: '/tmp',
        touchSession: () => {},
        capabilityMatches: () => true,
      })
      return () => compat.stop()
    })
  })
  assert.equal(host.routes.length, 1)
  assert.equal(connection.hasHandler, true)

  await host.stopWebInjects()
  assert.equal(host.routes.length, 0)
  await host.stop()
})

test('web compat: activate/unload 20 times keeps at most one registration', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const host = createHostContext(connection)
  apply(host.ctx)

  for (let i = 0; i < 20; i += 1) {
    await host.stopWebInjects()
    assert.ok(host.routes.length === 0, `unload ${i}`)
    host.ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => {
        const compat = mountVisionWebCompat({
          connection,
          webServer: host.ctx.webServer,
          router: { dispatch: async () => ({ ok: true }) },
          dshHome: '/tmp',
          touchSession: () => {},
          capabilityMatches: () => true,
        })
        return () => compat.stop()
      })
    })
    assert.equal(host.routes.length, 1, `mount ${i}`)
  }
  await host.stop()
  assert.equal(host.routes.length, 0)
})

test('web compat: Desktop without webServer still starts Fetch Host', async () => {
  unregisterVisionHost()
  const connection = mockRpcHost()
  const { ctx, routes, stop } = createHostContext(connection)
  delete ctx.webServer
  ctx.inject = (deps, fn) => {
    if (!Array.isArray(deps) || typeof fn !== 'function') return
    if (deps.every((name) => ctx[name] != null)) fn(ctx)
  }
  apply(ctx)
  assert.equal(routes.length, 0)
  assert.equal(connection.hasFetchHandler, true)
  assert.equal(connection.hasHandler, false)
  const live = await connection.invokeFetch('state', {})
  assert.equal(live.status, 200)
  await stop()
})

test('web compat: stop is idempotent and awaits late RPC disposer', async () => {
  let resolveReg
  const registration = new Promise((resolve) => {
    resolveReg = resolve
  })
  let disposeCalls = 0
  const connection = {
    rpc: {
      handle(channel, _fn) {
        assert.equal(channel, VISION_RPC_CHANNEL)
        return registration
      },
    },
  }
  const routes = []
  const compat = mountVisionWebCompat({
    connection,
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {
          routes.length = 0
        }
      },
    },
    router: { dispatch: async () => ({ ok: true }) },
    dshHome: '/tmp',
    touchSession: () => {},
    capabilityMatches: () => true,
  })
  const first = compat.stop()
  const second = compat.stop()
  assert.equal(first, second)
  resolveReg(() => {
    disposeCalls += 1
  })
  await first
  await second
  assert.equal(disposeCalls, 1)
  assert.equal(routes.length, 0)
})
