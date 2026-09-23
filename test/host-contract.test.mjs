import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, openTask, saveWorkspace } from '../bench-store.mjs'
import { _internal, apply, inject, name } from '../host.js'
import { clearFlashApprovals, defaultFlashApprovals } from '../src/application/flash/flash-approval-service.mjs'
import { VISION_RPC_CHANNEL } from '../src/shared/vision-rpc-contract.mjs'
import {
  CAPABILITY_HEADERS,
  capabilityHeaders,
  createHostContext,
  fakeRequest,
  fakeResponse,
  mockRpcHost,
} from './helpers/rpc-factory.mjs'
import { createBench } from './helpers/workspace-factory.mjs'


test('host named exports', async () => {
  assert.equal(name, 'dsh-vision-bench')
  assert.deepEqual(inject, ['connection'])
  const pkg = JSON.parse(
    await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )
  assert.equal(pkg.exports['./agent'], './tools.js')
  assert.equal(pkg.exports['./standing-guard'], undefined)
  assert.equal(pkg.exports['./scan-guard'], undefined)
})

test('host apply optionally injects webServer and the preset registry', async () => {
  const connection = mockRpcHost()
  const injected = []
  let toolRegs = 0
  const { ctx, stop } = createHostContext(connection)
  ctx.tools = {
    register() {
      toolRegs += 1
      return () => {}
    },
  }
  const baseInject = ctx.inject.bind(ctx)
  ctx.inject = (deps, fn) => {
    injected.push(deps)
    return baseInject(deps, fn)
  }
  apply(ctx)
  apply(ctx)
  // 两个可选注入都必须按序发生：webServer（Web 兼容）+ agentPresets（Vision模式声明）。
  assert.deepEqual(injected, [['webServer'], ['agentPresets'], ['webServer'], ['agentPresets']])
  assert.equal(toolRegs, 0)
  await stop()
})

test('state returns idle ioRuntime without starting a Worker', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-host-io-' })
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  await bench.useAsDshHome()
  // 断言失败也要拆掉宿主，否则 io worker 之类的资源会留在进程里。
  t.after(stop)
  const result = await connection.rpc.call(VISION_RPC_CHANNEL, 'state', {}, AbortSignal.timeout(5000))
  assert.equal(result.ok, true)
  const snap = result.value
  assert.equal(snap.ok, true)
  assert.ok(snap.ioRuntime)
  assert.equal(snap.ioRuntime.state, 'idle')
  assert.equal(snap.ioRuntime.pid, 0)
  assert.equal(snap.health.python.bound, false)
  assert.equal(snap.ioRuntime.capabilities.modbusTcp, 'unknown')
})

test('apply registers Fetch dispatch, Web command bridge, and disposes RPC', async () => {
  const disposed = []
  const connection = mockRpcHost()
  const { ctx, routes, stop } = createHostContext(connection)
  ctx.webServer = {
    register(entry) {
      disposed.push(entry.path)
      routes.push(entry)
      return () => {}
    },
  }
  apply(ctx)
  assert.deepEqual(disposed, ['/dsh-vision-bench/command'])
  assert.ok(connection.hasFetchHandler)
  assert.ok(connection.hasHandler)
  const hostSrc = await (await import('node:fs/promises')).readFile(new URL('../host.js', import.meta.url), 'utf8')
  assert.doesNotMatch(hostSrc, /schedulePresetSeed\(/)
  assert.doesNotMatch(hostSrc, /seedVisionBenchPreset/)
  assert.doesNotMatch(hostSrc, /bindAgentSurface/)
  assert.doesNotMatch(hostSrc, /role === 'agent'/)
  assert.match(hostSrc, /clearFlashApprovals\(\)/)
  assert.doesNotMatch(hostSrc, /ctx\.on\('internal\/plugin'/)
  assert.doesNotMatch(hostSrc, /plugin-lifecycle\.jsonl/)
  assert.doesNotMatch(hostSrc, /roster copy is best-effort/)
  assert.doesNotMatch(hostSrc, /const browser = origin/)
  assert.doesNotMatch(hostSrc, /route\('\/dsh-vision-bench\/state'/)
  assert.doesNotMatch(hostSrc, /connection\.register\(/)
  await stop()
  assert.equal(connection.disposed, true)
})

test('late RPC disposer still runs after the host fiber has disposed', async () => {
  let disposeCalls = 0
  let resolveReg
  const registration = new Promise((resolve) => {
    resolveReg = resolve
  })
  const connection = mockRpcHost()
  const baseHandle = connection.rpc.handle.bind(connection.rpc)
  connection.rpc.handle = (channel, fn) => {
    baseHandle(channel, fn)
    return registration
  }
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  const stopping = Promise.resolve(stop())
  resolveReg(() => {
    disposeCalls += 1
  })
  await stopping
  assert.ok(disposeCalls >= 1, 'late disposer must still run')
})

test('host dispose waits until the late RPC disposer finishes', async () => {
  let resolveReg
  const registration = new Promise((resolve) => {
    resolveReg = resolve
  })
  let disposeFinished = false
  const connection = mockRpcHost()
  const baseHandle = connection.rpc.handle.bind(connection.rpc)
  connection.rpc.handle = (channel, fn) => {
    baseHandle(channel, fn)
    return registration
  }
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  const stopping = Promise.resolve(stop())
  let stopDone = false
  stopping.then(() => {
    stopDone = true
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(stopDone, false)
  resolveReg(
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          disposeFinished = true
          resolve()
        }, 30)
      }),
  )
  await stopping
  assert.equal(disposeFinished, true)
  assert.equal(stopDone, true)
})

test('plugin dispose 清空刷写审批仓库', async () => {
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  clearFlashApprovals()
  apply(ctx)
  defaultFlashApprovals.create({
    cwd: '/tmp/ws',
    sessionId: 'sess-dispose',
    source: 'user',
    path: '/tmp/ws/app.hex',
    size: 1,
    sha256: 'aa',
    interfaceName: 'stlink',
    target: 'stm32f1x',
  })
  assert.ok(defaultFlashApprovals.size() > 0)
  await stop()
  assert.equal(defaultFlashApprovals.size(), 0)
})

test('command bridge rejects GET, missing capability, forged header, and foreign origin', async () => {
  const connection = mockRpcHost()
  const { ctx, routes } = createHostContext(connection)
  apply(ctx)
  const handler = routes[0].handler

  let box = fakeResponse()
  handler(fakeRequest('GET', capabilityHeaders()), box.res)
  assert.equal(box.status, 405)

  box = fakeResponse()
  handler(fakeRequest('POST', CAPABILITY_HEADERS), box.res)
  assert.equal(box.status, 403)
  assert.match(box.body, /missing capability/)

  box = fakeResponse()
  handler(fakeRequest('POST', { ...capabilityHeaders(), 'x-dsh-vision-capability': 'wrong-token' }), box.res)
  assert.equal(box.status, 403)
  assert.match(box.body, /invalid capability/)

  box = fakeResponse()
  handler(fakeRequest('POST', { ...capabilityHeaders(), origin: 'https://evil.example' }), box.res)
  assert.equal(box.status, 403)

  box = fakeResponse()
  handler(fakeRequest('POST', capabilityHeaders(), '', '8.8.8.8'), box.res)
  assert.equal(box.status, 403)
  assert.match(box.body, /loopback only/)
})

test('HTTP system.ping does not bind or mutate the workspace session', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-host-ping-' })
  const { home, cwd } = bench
  bench.save({})
  const connection = mockRpcHost()
  const { ctx, routes, stop } = createHostContext(connection)
  apply(ctx)
  await bench.useAsDshHome()
  t.after(stop)
  const command = routes.find((r) => r.path === '/dsh-vision-bench/command').handler
  const box = fakeResponse()
  await new Promise((resolve) => {
    box.res.end = (text) => {
      box.body = text
      resolve()
    }
    command(
      fakeRequest(
        'POST',
        capabilityHeaders(),
        JSON.stringify({
          action: 'system.ping',
          payload: { action: 'system.ping' },
          cwd,
          sessionId: 'must-not-bind',
          source: 'system',
        }),
      ),
      box.res,
    )
  })
  assert.equal(JSON.parse(box.body).ok, true)
  assert.equal(loadWorkspace(home, cwd).session.boundId, '')
})

test('state and bindings round-trip against an isolated home', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-host-' })
  const { home } = bench
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  await bench.useAsDshHome()
  t.after(stop)

  const empty = (await connection.rpc.call(VISION_RPC_CHANNEL, 'state', {}, AbortSignal.timeout(5000))).value
  assert.equal(empty.ok, true)
  assert.equal(empty.bindings.python, '')
  assert.equal(empty.health.python.bound, false)

  const abs = join(home, 'python3')
  const saved = (
    await connection.rpc.call(
      VISION_RPC_CHANNEL,
      'bindings/save',
      { bindings: { python: abs } },
      AbortSignal.timeout(5000),
    )
  ).value
  assert.equal(saved.ok, true)
  assert.equal(saved.bindings.python, abs)
})

test('state snapshot includes journal and workspace save cannot wipe tasks', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-host-j-' })
  const { home, cwd } = bench
  const connection = mockRpcHost()
  const { ctx, stop } = createHostContext(connection)
  apply(ctx)
  await bench.useAsDshHome()
  t.after(stop)
  const project = bench.at('app.uvprojx')
  saveWorkspace(home, cwd, { keil: { project, target: 'Debug' } })
  await openTask(home, cwd, { type: 'build', source: 'agent', sessionId: 'sess-3', summary: '编译 Debug' })

  const snap = (await connection.rpc.call(VISION_RPC_CHANNEL, 'state', { cwd }, AbortSignal.timeout(5000))).value
  assert.equal(snap.ok, true)
  assert.equal(snap.journal.running.length, 1)
  assert.equal(snap.journal.running[0].source, 'agent')
  assert.equal(snap.workspace.tasks[0].status, 'running')

  const saved = (
    await connection.rpc.call(
      VISION_RPC_CHANNEL,
      'workspace/save',
      {
        cwd,
        keil: { project, target: 'Debug', artifact: 'hex' },
        tasks: [],
        timeline: [],
      },
      AbortSignal.timeout(5000),
    )
  ).value
  assert.equal(saved.ok, true)
  assert.equal(saved.workspace.tasks[0].status, 'running')
  assert.equal(saved.journal.running.length, 1)

  const rejected = (
    await connection.rpc.call(
      VISION_RPC_CHANNEL,
      'workspace/save',
      { cwd, modbus: { points: [], version: 3 } },
      AbortSignal.timeout(5000),
    )
  ).value
  assert.equal(rejected.ok, false)
  assert.equal(rejected.errorCode, 'CONFIG_COMMAND_REQUIRED')
})
