import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply, inject, name, _internal } from '../host.js'
import { openTask, saveWorkspace } from '../bench-store.mjs'

function req(method, headers, body) {
  const stream = Readable.from([body ? Buffer.from(body) : Buffer.alloc(0)])
  stream.method = method
  stream.headers = headers || {}
  return stream
}

function resBox() {
  const box = { status: 0, body: '' }
  box.res = {
    writeHead(code) { box.status = code },
    end(text) { box.body = text },
  }
  return box
}

const csrf = { 'x-dsh-vision-bench': '1', origin: 'http://127.0.0.1:3080' }

test('host named exports', () => {
  assert.equal(name, 'dsh-vision-bench')
  assert.deepEqual(inject, ['webServer', 'tools', 'agentPresets'])
})

test('apply registers state and bindings routes and disposes them', () => {
  const disposed = []
  const routes = []
  const ctx = {
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => disposed.push(entry.path)
      },
    },
    tools: { register() { return () => {} } },
    effect(factory) { ctx._stop = factory() },
  }
  apply(ctx)
  const paths = routes.map((r) => r.path)
  assert.ok(paths.includes('/dsh-vision-bench/state'))
  assert.ok(paths.includes('/dsh-vision-bench/fs/list'))
  assert.ok(paths.includes('/dsh-vision-bench/keil/build'))
  assert.ok(paths.includes('/dsh-vision-bench/modbus/read'))
  assert.ok(paths.includes('/dsh-vision-bench/modbus/poll'))
  assert.ok(paths.includes('/dsh-vision-bench/serial/ports'))
  ctx._stop()
  assert.deepEqual(disposed, paths)
})

test('routes reject GET, missing header, and foreign origin', async () => {
  const routes = []
  apply({
    webServer: { register(entry) { routes.push(entry); return () => {} } },
    tools: { register() { return () => {} } },
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

test('state and save round-trip against an isolated home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-host-'))
  const routes = []
  apply({
    webServer: { register(entry) { routes.push(entry); return () => {} } },
    tools: { register() { return () => {} } },
    effect() {},
  })
  _internal.setDshHome(home)
  const state = routes.find((r) => r.path === '/dsh-vision-bench/state').handler
  const save = routes.find((r) => r.path === '/dsh-vision-bench/bindings').handler

  const emptyBox = resBox()
  await new Promise((resolve) => {
    emptyBox.res.end = (text) => { emptyBox.body = text; resolve() }
    state(req('POST', csrf), emptyBox.res)
  })
  const empty = JSON.parse(emptyBox.body)
  assert.equal(empty.ok, true)
  assert.equal(empty.bindings.python, '')
  assert.equal(empty.health.python.bound, false)

  const abs = join(home, 'python3')
  const saveBox = resBox()
  await new Promise((resolve) => {
    saveBox.res.end = (text) => { saveBox.body = text; resolve() }
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
    webServer: { register(entry) { routes.push(entry); return () => {} } },
    tools: { register() { return () => {} } },
    effect() {},
  })
  _internal.setDshHome(home)
  try {
    const project = join(cwd, 'app.uvprojx')
    saveWorkspace(home, cwd, { keil: { project, target: 'Debug' } })
    openTask(home, cwd, { type: 'build', source: 'agent', sessionId: 'sess-3', summary: '编译 Debug' })

    const state = routes.find((r) => r.path === '/dsh-vision-bench/state').handler
    const box = resBox()
    await new Promise((resolve) => {
      box.res.end = (text) => { box.body = text; resolve() }
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
      saveBox.res.end = (text) => { saveBox.body = text; resolve() }
      save(req('POST', csrf, JSON.stringify({
        cwd,
        keil: { project, target: 'Debug', artifact: 'hex' },
        tasks: [],
        timeline: [],
      })), saveBox.res)
    })
    const saved = JSON.parse(saveBox.body)
    assert.equal(saved.ok, true)
    assert.equal(saved.workspace.tasks[0].status, 'running')
    assert.equal(saved.journal.running.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
