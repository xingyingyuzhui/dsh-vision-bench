// @ts-check
// P1-2：Host/RPC 工厂自身的契约。最关键的一条是「工厂的 envelope 必须等于 host.js
// 真实产出的 envelope」——否则测试会用旧形状构造 mock 并静默通过，正是本次要消除的漂移。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyHost,
  businessFail,
  businessOk,
  CAPABILITY_HEADERS,
  capabilityHeaders,
  createHostContext,
  createPost,
  createRouter,
  fakeRequest,
  fakeResponse,
  mockConnection,
  mockRpcHost,
  rpcFail,
  rpcOk,
  VISION_RPC_CHANNEL,
  _internal,
} from '../helpers/rpc-factory.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

/** 起一个真实的 host 插件实例，用于对照 envelope 契约。 */
async function withRealHost(bench, fn) {
  _internal.setDshHome(bench.home)
  const connection = mockRpcHost()
  const { ctx } = createHostContext(connection)
  applyHost(ctx)
  try {
    return await fn(connection)
  } finally {
    await ctx._stop?.()
  }
}

test('rpcOk / rpcFail 只表达宿主层结果', () => {
  assert.deepEqual(rpcOk({ ok: true }), { ok: true, value: { ok: true } })
  assert.deepEqual(rpcFail('forbidden', 'unauthenticated'), {
    ok: false,
    error: { code: 'forbidden', message: 'unauthenticated', details: {} },
  })
  assert.deepEqual(rpcFail('x', 'y', { hint: 1 }).error.details, { hint: 1 })
})

test('businessOk / businessFail 是 router 层的业务结果，不是 envelope', () => {
  assert.deepEqual(businessOk(), { ok: true })
  assert.deepEqual(businessOk({ workspace: 1 }), { ok: true, workspace: 1 })
  assert.deepEqual(businessFail('CONFIG_DRIFT', '请刷新'), {
    ok: false,
    errorCode: 'CONFIG_DRIFT',
    error: '请刷新',
  })
  // needsConfirm 这类附加字段必须能被带上（审批工单场景）
  assert.equal(businessFail('X', 'y', { needsConfirm: true, request: { requestId: 'r1' } }).needsConfirm, true)
})

test('工厂 envelope 与 host.js 真实返回值一致', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rpc-env-' })
  await withRealHost(bench, async (connection) => {
    // 成功：host 把 router 的业务结果包进 value
    const ok = await connection.invoke('state', { cwd: bench.cwd })
    assert.deepEqual(Object.keys(ok).sort(), Object.keys(rpcOk(null)).sort(), '成功 envelope 顶层键一致')
    assert.equal(ok.ok, true)
    assert.ok('value' in ok, '成功 envelope 必须带 value')
    assert.equal(ok.value.ok, true, '业务结果原样放在 value 里')

    // 业务失败**不是** transport failure：仍走 ok:true，失败嵌在 value 里
    const missing = await connection.invoke('missing/endpoint', { cwd: bench.cwd })
    assert.equal(missing.ok, true, '未知端点属于业务失败，不是宿主层失败')
    assert.equal(missing.value.ok, false)
    assert.equal(missing.value.errorCode, 'NOT_FOUND')

    // transport failure：让 handler 真的抛（非字符串 path 会让 fs 断言失败）
    const threw = await connection.invoke('fs/list', { cwd: bench.cwd, path: 12345 })
    assert.equal(threw.ok, false, '抛异常必须降级为宿主层失败')
    assert.deepEqual(Object.keys(threw).sort(), Object.keys(rpcFail('x', 'y')).sort())
    assert.deepEqual(Object.keys(threw.error).sort(), ['code', 'details', 'message'])
    assert.equal(threw.error.code, 'internal')
    assert.equal(typeof threw.error.message, 'string')
    assert.ok(threw.error.message.length > 0)
  })
})

test('mockConnection 支持成功 / 结构化失败 / transport failure 三种 envelope 形态', async () => {
  // 裸业务结果自动包进 rpcOk
  const okMock = mockConnection(() => businessOk({ endpoint: 'state' }))
  assert.deepEqual(await okMock.connection.rpc.call(VISION_RPC_CHANNEL, 'state', {}), rpcOk({ ok: true, endpoint: 'state' }))
  assert.equal(okMock.calls.length, 1)
  assert.equal(okMock.lastCall().endpoint, 'state')

  // 显式 envelope 原样透传（结构化失败）
  const failMock = mockConnection(() => rpcOk(businessFail('CONFIG_DRIFT', '请刷新')))
  assert.deepEqual(await failMock.connection.rpc.call(VISION_RPC_CHANNEL, 'points/flags', {}), {
    ok: true,
    value: { ok: false, errorCode: 'CONFIG_DRIFT', error: '请刷新' },
  })

  // transport failure 不被包一层
  const transportMock = mockConnection(() => rpcFail('forbidden', 'unauthenticated'))
  const out = await transportMock.connection.rpc.call(VISION_RPC_CHANNEL, 'state', {})
  assert.equal(out.ok, false)
  assert.equal(out.error.message, 'unauthenticated')
})

test('mockConnection 支持取消与跨会话两种场景', async () => {
  const cancelling = mockConnection((_ep, _pl, signal) =>
    signal?.aborted ? rpcFail('cancelled', 'aborted') : businessOk(),
  )
  const live = new AbortController()
  assert.equal((await cancelling.connection.rpc.call(VISION_RPC_CHANNEL, 'state', {}, live.signal)).ok, true)
  const dead = new AbortController()
  dead.abort()
  const cancelled = await cancelling.connection.rpc.call(VISION_RPC_CHANNEL, 'state', {}, dead.signal)
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.error.code, 'cancelled')

  const perSession = mockConnection((_ep, payload) =>
    payload.sessionId === 'a' ? businessOk({ who: 'a' }) : businessFail('SESSION_MISMATCH', '不匹配'),
  )
  const asA = await perSession.connection.rpc.call(VISION_RPC_CHANNEL, 'state', { sessionId: 'a' })
  assert.equal(asA.value.who, 'a')
  const asB = await perSession.connection.rpc.call(VISION_RPC_CHANNEL, 'state', { sessionId: 'b' })
  assert.equal(asB.value.errorCode, 'SESSION_MISMATCH')
})

test('createPost 解包 value 并把 transport failure 抛成异常', async () => {
  const { post, calls } = createPost((endpoint) =>
    endpoint === 'state' ? businessOk({ workspace: { modbus: { configVersion: 3 } } }) : businessFail('NOPE', 'x'),
  )
  const data = await post('/dsh-vision-bench/state', { cwd: '/ws' })
  assert.equal(data.ok, true)
  assert.equal(data.workspace.modbus.configVersion, 3, 'value 被解包')
  assert.equal(calls[0].endpoint, 'state', '路径被映射成端点')
  assert.equal(calls[0].channel, VISION_RPC_CHANNEL)

  const broken = createPost(() => rpcFail('forbidden', 'unauthenticated'))
  await assert.rejects(() => broken.post('/dsh-vision-bench/state', {}), /unauthenticated/)
})

test('mockRpcHost 校验频道、暴露注册状态并支持注销', async () => {
  const host = mockRpcHost()
  assert.equal(host.hasHandler, false)
  assert.throws(() => host.invoke('state', {}), /rpc handler missing/)
  assert.throws(() => host.rpc.handle('/wrong-channel', () => {}), /unexpected RPC channel/)

  const dispose = host.rpc.handle(VISION_RPC_CHANNEL, () => rpcOk({ ok: true }))
  assert.equal(host.hasHandler, true)
  assert.equal(host.disposed, false)
  assert.deepEqual(await host.invoke('state', {}), { ok: true, value: { ok: true } })

  await dispose()
  assert.equal(host.disposed, true)
  assert.equal(host.hasHandler, false)
})

test('createHostContext 收集路由与工具，overrides 可定制 connection', () => {
  const connection = mockRpcHost()
  const { ctx, routes, tools, stop } = createHostContext(connection)
  assert.equal(ctx.connection, connection)
  ctx.webServer.register({ path: '/a' })
  ctx.tools.register({ name: 'vision_bench' })
  assert.deepEqual(
    routes.map((r) => r.path),
    ['/a'],
  )
  assert.equal(tools[0].name, 'vision_bench')
  assert.equal(stop(), undefined, '没有 effect 时 stop 是安全的空操作')

  let cleaned = 0
  const custom = createHostContext(connection, {
    connection: { rpc: { handle: () => () => {} }, register: () => Promise.resolve(() => {}) },
    effect(factory) {
      factory()
      cleaned += 1
    },
  })
  custom.ctx.effect(() => () => {})
  assert.equal(cleaned, 1)
  assert.equal(custom.ctx.connection.register !== undefined, true, 'overrides 替换了 connection')
  // stop() 只对默认 effect 有效——自定义 effect 必须自己把清理函数挂到 ctx._stop。
  assert.equal(custom.stop(), undefined)
  let stopped = 0
  const explicit = createHostContext(connection, {
    effect(factory) {
      explicit.ctx._stop = factory()
    },
  })
  explicit.ctx.effect(() => () => {
    stopped += 1
  })
  assert.equal(stopped, 0)
  assert.equal(explicit.stop(), undefined, 'stop() 返回清理函数的返回值')
  assert.equal(stopped, 1, 'stop() 确实调用了 effect 注册的清理函数')
})

test('capabilityHeaders 每次签发一次性凭据，fakeRequest/fakeResponse 可驱动路由', async () => {
  const a = capabilityHeaders()
  const b = capabilityHeaders()
  assert.equal(a.origin, CAPABILITY_HEADERS.origin)
  assert.equal(a['content-type'], 'application/json')
  assert.ok(a['x-dsh-vision-capability'])
  assert.notEqual(a['x-dsh-vision-capability'], b['x-dsh-vision-capability'], '每次签发都不同')

  const extra = capabilityHeaders({ origin: 'https://evil.example' })
  assert.equal(extra.origin, 'https://evil.example', '可覆盖默认头')

  const req = fakeRequest('POST', a, '{"a":1}', '8.8.8.8')
  assert.equal(req.method, 'POST')
  assert.equal(req.socket.remoteAddress, '8.8.8.8')
  const chunks = []
  for await (const c of req) chunks.push(c)
  assert.equal(Buffer.concat(chunks).toString('utf8'), '{"a":1}')

  const empty = fakeRequest('GET', {})
  assert.equal(empty.socket.remoteAddress, '127.0.0.1', '默认回环地址')
  const box = fakeResponse()
  box.res.writeHead(403)
  box.res.end('nope')
  assert.equal(box.status, 403)
  assert.equal(box.body, 'nope')
})

test('createRouter 派发真实端点，dispatchAs 注入会话身份', async (t) => {
  const bench = await createBench(t, {
    prefix: 'dvb-rpc-router-',
    sessions: {
      'session-a': { connections: [{ id: 'conn-a', name: 'A', role: 'client', enabled: true, conn: { mode: 'tcp' } }] },
      'session-b': { connections: [{ id: 'conn-b', name: 'B', role: 'client', enabled: true, conn: { mode: 'tcp' } }] },
    },
  })
  const { dispatch, dispatchAs } = createRouter(bench.home)

  const snap = await dispatch('state', { cwd: bench.cwd })
  assert.equal(snap.ok, true)

  const asA = await dispatchAs('session-a', 'workspace/get', { cwd: bench.cwd })
  assert.equal(asA.ok, true)
  assert.equal(asA.workspace.modbus.connections[0].id, 'conn-a')
  assert.equal(asA.workspace.modbus.sessionConfigs, undefined, '会话私有层必须被剥离')

  const asB = await dispatchAs('session-b', 'workspace/get', { cwd: bench.cwd })
  assert.equal(asB.workspace.modbus.connections[0].id, 'conn-b')

  const missing = await dispatch('missing/endpoint', {})
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'NOT_FOUND')
})

test('createRouter 透传 deps，dispatchAs 在无 payload 时也能用', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rpc-deps-' })
  let seen = null
  const { dispatchAs } = createRouter(bench.home, {
    debugRpcHandler: (endpoint, body) => {
      seen = { endpoint, body }
      return { ok: true, from: 'injected' }
    },
  })
  const res = await dispatchAs('s1', 'debug/state')
  assert.equal(res.from, 'injected')
  assert.equal(seen.endpoint, 'debug/state')
  assert.equal(seen.body.sessionId, 's1', '会话身份被注入')
  assert.equal(seen.body.home, bench.home, 'host 会把 home 带上')
})
