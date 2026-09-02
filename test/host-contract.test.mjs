import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { loadWorkspace, openTask, saveWorkspace } from '../bench-store.mjs'
import { _internal, apply, inject, name } from '../host.js'
import { clearFlashApprovals, defaultFlashApprovals } from '../src/application/flash/flash-approval-service.mjs'
import { VISION_RPC_CHANNEL } from '../src/shared/vision-rpc-contract.mjs'

function createMockConnection() {
  /** @type {((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | null} */
  let handler = null
  let disposed = false
  return {
    rpc: {
      handle(channel, fn) {
        assert.equal(channel, VISION_RPC_CHANNEL)
        handler = fn
        return () => {
          disposed = true
          handler = null
          return Promise.resolve()
        }
      },
      async call(_channel, endpoint, payload, signal) {
        if (!handler) throw new Error('rpc handler missing')
        return handler(endpoint, payload, signal)
      },
    },
    get disposed() {
      return disposed
    },
    get hasHandler() {
      return handler != null
    },
  }
}

function createHostCtx(connection) {
  const routes = []
  const ctx = {
    connection,
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {}
      },
    },
    tools: {
      register() {
        return () => {}
      },
    },
    effect(factory) {
      ctx._stop = factory()
    },
  }
  return { ctx, routes }
}

function req(method, headers, body, addr = '127.0.0.1') {
  const stream = Readable.from([body ? Buffer.from(body) : Buffer.alloc(0)])
  stream.method = method
  stream.headers = headers || {}
  stream.socket = { remoteAddress: addr }
  return stream
}

function resBox() {
  const box = { status: 0, body: '' }
  box.res = {
    writeHead(code) {
      box.status = code
    },
    end(text) {
      box.body = text
    },
  }
  return box
}

const csrf = { origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }

function withCapability(headers = csrf) {
  const cap = _internal.issueBridgeCapability()
  return { ...headers, 'x-dsh-vision-capability': cap }
}

test('host named exports', async () => {
  assert.equal(name, 'dsh-vision-bench')
  assert.deepEqual(inject, ['connection', 'webServer', 'tools', 'agentPresets', 'systemPrompt'])
})

test('state returns idle ioRuntime without starting a Worker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-io-'))
  const connection = createMockConnection()
  const { ctx } = createHostCtx(connection)
  let stop
  apply(ctx)
  stop = ctx._stop
  _internal.setDshHome(home)
  try {
    const result = await connection.rpc.call(VISION_RPC_CHANNEL, 'state', {}, AbortSignal.timeout(5000))
    assert.equal(result.ok, true)
    const snap = result.value
    assert.equal(snap.ok, true)
    assert.ok(snap.ioRuntime)
    assert.equal(snap.ioRuntime.state, 'idle')
    assert.equal(snap.ioRuntime.pid, 0)
    assert.equal(snap.health.python.bound, false)
    assert.equal(snap.ioRuntime.capabilities.modbusTcp, 'unknown')
  } finally {
    if (stop) stop()
    await rm(home, { recursive: true, force: true })
  }
})

test('apply registers only agent command bridge and disposes RPC', async () => {
  const disposed = []
  const connection = createMockConnection()
  const ctx = {
    connection,
    webServer: {
      register(entry) {
        disposed.push(entry.path)
        return () => {}
      },
    },
    tools: {
      register() {
        return () => {}
      },
    },
    effect(factory) {
      ctx._stop = factory()
    },
  }
  apply(ctx)
  assert.deepEqual(disposed, ['/dsh-vision-bench/command'])
  assert.ok(connection.hasHandler)
  const hostSrc = await (await import('node:fs/promises')).readFile(new URL('../host.js', import.meta.url), 'utf8')
  assert.match(hostSrc, /Vision预设未更新/)
  assert.match(hostSrc, /clearFlashApprovals\(\)/)
  assert.doesNotMatch(hostSrc, /roster copy is best-effort/)
  assert.doesNotMatch(hostSrc, /const browser = origin/)
  assert.doesNotMatch(hostSrc, /route\('\/dsh-vision-bench\/state'/)
  ctx._stop()
  assert.equal(connection.disposed, true)
})

test('plugin dispose 清空刷写审批仓库', async () => {
  const connection = createMockConnection()
  const ctx = createHostCtx(connection).ctx
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
  ctx._stop()
  assert.equal(defaultFlashApprovals.size(), 0)
})

test('command bridge rejects GET, missing capability, forged header, and foreign origin', async () => {
  const connection = createMockConnection()
  const { ctx, routes } = createHostCtx(connection)
  apply(ctx)
  const handler = routes[0].handler

  let box = resBox()
  handler(req('GET', withCapability()), box.res)
  assert.equal(box.status, 405)

  box = resBox()
  handler(req('POST', csrf), box.res)
  assert.equal(box.status, 403)
  assert.match(box.body, /missing capability/)

  box = resBox()
  handler(req('POST', { ...withCapability(), 'x-dsh-vision-capability': 'wrong-token' }), box.res)
  assert.equal(box.status, 403)
  assert.match(box.body, /invalid capability/)

  box = resBox()
  handler(req('POST', { ...withCapability(), origin: 'https://evil.example' }), box.res)
  assert.equal(box.status, 403)

  box = resBox()
  handler(req('POST', withCapability(), '', '8.8.8.8'), box.res)
  assert.equal(box.status, 403)
  assert.match(box.body, /loopback only/)
})

test('HTTP system.ping does not bind or mutate the workspace session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-ping-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  saveWorkspace(home, cwd, {})
  const connection = createMockConnection()
  const { ctx, routes } = createHostCtx(connection)
  let stop = () => {}
  apply(ctx)
  stop = ctx._stop
  _internal.setDshHome(home)
  try {
    const command = routes.find((r) => r.path === '/dsh-vision-bench/command').handler
    const box = resBox()
    await new Promise((resolve) => {
      box.res.end = (text) => {
        box.body = text
        resolve()
      }
      command(
        req(
          'POST',
          withCapability(),
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
  } finally {
    stop()
    await rm(home, { recursive: true, force: true })
  }
})

test('state and bindings round-trip against an isolated home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-'))
  const connection = createMockConnection()
  const { ctx } = createHostCtx(connection)
  apply(ctx)
  _internal.setDshHome(home)

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

  await rm(home, { recursive: true, force: true })
})

test('state snapshot includes journal and workspace save cannot wipe tasks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-j-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const connection = createMockConnection()
  const { ctx } = createHostCtx(connection)
  apply(ctx)
  _internal.setDshHome(home)
  try {
    const project = join(cwd, 'app.uvprojx')
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
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
