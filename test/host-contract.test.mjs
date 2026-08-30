import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { loadWorkspace, openTask, saveWorkspace } from '../bench-store.mjs'
import { _internal, apply, inject, name } from '../host.js'

function req(method, headers, body) {
  const stream = Readable.from([body ? Buffer.from(body) : Buffer.alloc(0)])
  stream.method = method
  stream.headers = headers || {}
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

const csrf = { 'x-dsh-vision-bench': '1', origin: 'http://127.0.0.1:3080' }

test('host named exports', async () => {
  assert.equal(name, 'dsh-vision-bench')
  assert.deepEqual(inject, ['webServer', 'tools', 'agentPresets', 'systemPrompt'])
})

test('/state returns idle ioRuntime without starting a Worker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-io-'))
  const routes = []
  let stop
  apply({
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
      stop = factory()
    },
  })
  _internal.setDshHome(home)
  try {
    const state = routes.find((r) => r.path === '/dsh-vision-bench/state').handler
    const box = resBox()
    await new Promise((resolve) => {
      box.res.end = (text) => {
        box.body = text
        resolve()
      }
      state(req('POST', csrf), box.res)
    })
    const snap = JSON.parse(box.body)
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

test('apply registers state and bindings routes and disposes them', async () => {
  const disposed = []
  const routes = []
  const ctx = {
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => disposed.push(entry.path)
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
  const paths = routes.map((r) => r.path)
  assert.ok(paths.includes('/dsh-vision-bench/state'))
  assert.ok(paths.includes('/dsh-vision-bench/fs/list'))
  assert.ok(paths.includes('/dsh-vision-bench/keil/build'))
  assert.ok(paths.includes('/dsh-vision-bench/keil/map'))
  assert.ok(paths.includes('/dsh-vision-bench/modbus/read'))
  assert.ok(paths.includes('/dsh-vision-bench/modbus/poll'))
  assert.ok(paths.includes('/dsh-vision-bench/serial/ports'))
  assert.ok(paths.includes('/dsh-vision-bench/connection/open'))
  assert.ok(paths.includes('/dsh-vision-bench/connection/close'))
  assert.ok(paths.includes('/dsh-vision-bench/serial/feed'))
  assert.ok(paths.includes('/dsh-vision-bench/command'))
  assert.ok(!paths.includes('/dsh-vision-bench/config/draft'))
  assert.ok(!paths.includes('/dsh-vision-bench/config/draft/apply'))
  assert.ok(!paths.includes('/dsh-vision-bench/serial/open'))
  assert.ok(!paths.includes('/dsh-vision-bench/serial/close'))
  ctx._stop()
  assert.deepEqual(disposed, paths)
})

test('routes reject GET, missing header, and foreign origin', async () => {
  const routes = []
  apply({
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
    effect() {},
  })
  const handler = routes[0].handler

  let box = resBox()
  handler(req('GET', csrf), box.res)
  assert.equal(box.status, 405)

  box = resBox()
  handler(req('POST', {}), box.res)
  assert.equal(box.status, 403)

  box = resBox()
  handler(req('POST', { 'x-dsh-vision-bench': '1', origin: 'https://evil.example' }), box.res)
  assert.equal(box.status, 403)
})

test('HTTP system.ping does not bind or mutate the workspace session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-ping-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  saveWorkspace(home, cwd, {})
  const routes = []
  let stop = () => {}
  apply({
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {}
      },
    },
    tools: { register: () => () => {} },
    effect(factory) {
      stop = factory()
    },
  })
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
          csrf,
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

test('state and save round-trip against an isolated home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-'))
  const routes = []
  apply({
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
    effect() {},
  })
  _internal.setDshHome(home)
  const state = routes.find((r) => r.path === '/dsh-vision-bench/state').handler
  const save = routes.find((r) => r.path === '/dsh-vision-bench/bindings').handler

  const emptyBox = resBox()
  await new Promise((resolve) => {
    emptyBox.res.end = (text) => {
      emptyBox.body = text
      resolve()
    }
    state(req('POST', csrf), emptyBox.res)
  })
  const empty = JSON.parse(emptyBox.body)
  assert.equal(empty.ok, true)
  assert.equal(empty.bindings.python, '')
  assert.equal(empty.health.python.bound, false)

  const abs = join(home, 'python3')
  const saveBox = resBox()
  await new Promise((resolve) => {
    saveBox.res.end = (text) => {
      saveBox.body = text
      resolve()
    }
    save(req('POST', csrf, JSON.stringify({ bindings: { python: abs } })), saveBox.res)
  })
  const saved = JSON.parse(saveBox.body)
  assert.equal(saved.ok, true)
  assert.equal(saved.bindings.python, abs)

  await rm(home, { recursive: true, force: true })
})

test('state snapshot includes journal and workspace save cannot wipe tasks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-j-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const routes = []
  apply({
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
    effect() {},
  })
  _internal.setDshHome(home)
  try {
    const project = join(cwd, 'app.uvprojx')
    saveWorkspace(home, cwd, { keil: { project, target: 'Debug' } })
    await openTask(home, cwd, { type: 'build', source: 'agent', sessionId: 'sess-3', summary: '编译 Debug' })

    const state = routes.find((r) => r.path === '/dsh-vision-bench/state').handler
    const box = resBox()
    await new Promise((resolve) => {
      box.res.end = (text) => {
        box.body = text
        resolve()
      }
      state(req('POST', csrf, JSON.stringify({ cwd })), box.res)
    })
    const snap = JSON.parse(box.body)
    assert.equal(snap.ok, true)
    assert.equal(snap.journal.running.length, 1)
    assert.equal(snap.journal.running[0].source, 'agent')
    assert.equal(snap.workspace.tasks[0].status, 'running')

    const save = routes.find((r) => r.path === '/dsh-vision-bench/workspace').handler
    const saveBox = resBox()
    await new Promise((resolve) => {
      saveBox.res.end = (text) => {
        saveBox.body = text
        resolve()
      }
      save(
        req(
          'POST',
          csrf,
          JSON.stringify({
            cwd,
            keil: { project, target: 'Debug', artifact: 'hex' },
            tasks: [],
            timeline: [],
          }),
        ),
        saveBox.res,
      )
    })
    const saved = JSON.parse(saveBox.body)
    assert.equal(saved.ok, true)
    assert.equal(saved.workspace.tasks[0].status, 'running')
    assert.equal(saved.journal.running.length, 1)

    const rejectedBox = resBox()
    await new Promise((resolve) => {
      rejectedBox.res.end = (text) => {
        rejectedBox.body = text
        resolve()
      }
      save(req('POST', csrf, JSON.stringify({ cwd, modbus: { points: [], version: 3 } })), rejectedBox.res)
    })
    const rejected = JSON.parse(rejectedBox.body)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.errorCode, 'CONFIG_COMMAND_REQUIRED')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
