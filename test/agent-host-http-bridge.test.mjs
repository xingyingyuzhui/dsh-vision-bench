import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { dispatchVisionCommand, unregisterVisionHost } from '../src/infrastructure/host/vision-host-client.mjs'
import { handleCommand } from '../src/interfaces/http/vision-command-routes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(root, 'test/fixtures/agent-http-child.mjs')

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

function startHost(home, cwd) {
  return listen((req, res) => {
    if (req.method !== 'POST' || req.url !== '/dsh-vision-bench/command') {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const fakeReq = {
          method: 'POST',
          headers: { 'x-dsh-vision-bench': '1' },
        }
        const result = await handleCommand(home, fakeReq, async () => ({ ...body, cwd: body.cwd || cwd }))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error && error.message) }))
      }
    })
  })
}

function spawnChild(origin, command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath], {
      shell: false,
      env: {
        ...process.env,
        VISION_BENCH_HOST_ORIGIN: origin,
        VISION_BENCH_CHILD_COMMAND: JSON.stringify(command),
        ...extraEnv,
      },
    })
    const chunks = []
    const errChunks = []
    child.stdout.on('data', (c) => chunks.push(c))
    child.stderr.on('data', (c) => errChunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf8')
      let parsed = null
      try {
        parsed = JSON.parse(stdout)
      } catch {
        parsed = { raw: stdout }
      }
      resolve({ code, parsed, stderr: Buffer.concat(errChunks).toString('utf8') })
    })
  })
}

test('HTTP fallback distinguishes unavailable vs status vs invalid JSON', async () => {
  unregisterVisionHost()
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = 'http://127.0.0.1:1'
  try {
    const down = await dispatchVisionCommand({
      requireHost: true,
      commandId: 'c-down',
      action: 'status',
      cwd: '/tmp/x',
      payload: { action: 'status' },
    })
    assert.equal(down.ok, false)
    assert.ok(['HOST_UNAVAILABLE', 'HOST_HTTP_STATUS_ERROR', 'HOST_INVALID_RESPONSE'].includes(down.errorCode))
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
  }

  const { server, origin } = await listen((req, res) => {
    if (req.url === '/dsh-vision-bench/command') {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    res.writeHead(404)
    res.end()
  })
  process.env.VISION_BENCH_HOST_ORIGIN = origin
  try {
    const ran = await dispatchVisionCommand({
      requireHost: true,
      commandId: 'c-503',
      action: 'status',
      cwd: '/tmp/x',
      payload: { action: 'status' },
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'HOST_HTTP_STATUS_ERROR')
    assert.equal(ran.httpStatus, 503)
    assert.ok(ran.origin)
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
    await new Promise((r) => server.close(r))
  }
})

test('uses HTTP transport when in-process host is unavailable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-http-host-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  const { server, origin } = await startHost(home, cwd)
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = origin
  unregisterVisionHost()
  try {
    const added = await dispatchVisionCommand({
      requireHost: true,
      home,
      cwd,
      sessionId: 's1',
      source: 'agent',
      commandId: 'http-add',
      action: 'points',
      payload: {
        action: 'points',
        op: 'add',
        connectionId: 'c1',
        deviceId: 'd1',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        point: { name: 'FromHttp', function: 3, address: 4 },
      },
    })
    assert.equal(added.ok, true, added.error)
    assert.equal(loadWorkspace(home, cwd).modbus.points.length, 1)
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
    unregisterVisionHost()
    await new Promise((r) => server.close(r))
    await rm(home, { recursive: true, force: true })
  }
})

test('real Node child process talks to HTTP Host without becoming I/O owner', async () => {
  const fixtureSrc = readFileSync(fixturePath, 'utf8')
  assert.match(fixtureSrc, /vision-host-client/)
  assert.doesNotMatch(fixtureSrc, /bench-modbus-transport|vision-io-worker|serialport|modbus-serial/)
  assert.doesNotMatch(fixtureSrc, /createServer|bench-modbus-transport|vision-io-worker/)

  const home = await mkdtemp(join(tmpdir(), 'dvb-http-child-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  const { server, origin } = await startHost(home, cwd)
  unregisterVisionHost()
  try {
    const status = await spawnChild(origin, {
      cwd,
      sessionId: 'sess-child',
      source: 'agent',
      commandId: 'child-status',
      action: 'status',
      payload: { action: 'status' },
    })
    assert.equal(status.code, 0, status.stderr || JSON.stringify(status.parsed))
    assert.equal(status.parsed.result.ok, true)
    assert.equal(status.parsed.cwd, cwd)
    assert.equal(status.parsed.sessionId, 'sess-child')
    assert.equal(status.parsed.source, 'agent')
    assert.notEqual(status.parsed.pid, process.pid)

    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const added = await spawnChild(origin, {
      cwd,
      sessionId: 'sess-child',
      source: 'agent',
      commandId: 'child-add',
      action: 'points',
      payload: {
        action: 'points',
        op: 'add',
        connectionId: 'c1',
        deviceId: 'd1',
        expectedConfigVersion: cv,
        point: { name: 'FromChild', function: 3, address: 8, monitorEnabled: true },
      },
    })
    assert.equal(added.code, 0, added.stderr || JSON.stringify(added.parsed))
    assert.equal(added.parsed.result.ok, true, added.parsed.result?.error)
    const afterAdd = loadWorkspace(home, cwd)
    assert.equal(afterAdd.modbus.points.length, 1)
    assert.equal(afterAdd.modbus.points[0].name, 'FromChild')

    const patched = await spawnChild(origin, {
      cwd,
      sessionId: 'sess-child',
      source: 'agent',
      commandId: 'child-update',
      action: 'points',
      payload: {
        action: 'points',
        op: 'update',
        connectionId: 'c1',
        deviceId: 'd1',
        expectedConfigVersion: afterAdd.modbus.configVersion,
        point: { id: afterAdd.modbus.points[0].id, name: 'ChildPatched' },
      },
    })
    assert.equal(patched.code, 0, patched.stderr || JSON.stringify(patched.parsed))
    assert.equal(loadWorkspace(home, cwd).modbus.points[0].name, 'ChildPatched')

    const viz = await spawnChild(origin, {
      cwd,
      sessionId: 'sess-child',
      source: 'agent',
      commandId: 'child-viz',
      action: 'visualization',
      payload: {
        action: 'visualization',
        op: 'add',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        component: { name: 'ChildGauge', type: 'value', pointIds: [loadWorkspace(home, cwd).modbus.points[0].id] },
      },
    })
    assert.equal(viz.code, 0, JSON.stringify(viz.parsed) + viz.stderr)
    assert.equal(viz.parsed.result.ok, true, viz.parsed.result?.error)
    assert.equal((loadWorkspace(home, cwd).modbus.visualization?.components || []).length, 1)

    const missing = await spawnChild('', {
      cwd,
      sessionId: 'sess-child',
      source: 'agent',
      commandId: 'child-miss',
      action: 'status',
      payload: { action: 'status' },
    })
    assert.notEqual(missing.code, 0)
    assert.equal(missing.parsed.errorCode, 'HOST_UNAVAILABLE')

    const bad = await spawnChild('http://127.0.0.1:1', {
      cwd,
      sessionId: 'sess-child',
      source: 'agent',
      commandId: 'child-bad',
      action: 'status',
      payload: { action: 'status' },
    })
    assert.notEqual(bad.code, 0)
    assert.equal(bad.parsed.result?.errorCode || bad.parsed.errorCode, 'HOST_UNAVAILABLE')
  } finally {
    unregisterVisionHost()
    await new Promise((r) => server.close(r))
    await rm(home, { recursive: true, force: true })
  }
})
