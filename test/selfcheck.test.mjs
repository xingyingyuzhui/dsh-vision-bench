import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runSelfCheck } from '../bench-check.mjs'
import { stopVisionIoBroker } from '../bench-io-broker.mjs'
import { saveBindings } from '../bench-store.mjs'
import { executeVisionCommand } from '../src/application/commands/vision-command-service.mjs'
import {
  pingVisionHost,
  registerVisionHost,
  unregisterVisionHost,
} from '../src/infrastructure/host/vision-host-client.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

async function withOrigin(origin, fn) {
  const prev = process.env.VISION_BENCH_HOST_ORIGIN
  process.env.VISION_BENCH_HOST_ORIGIN = origin
  unregisterVisionHost()
  try {
    return await fn()
  } finally {
    if (prev == null) delete process.env.VISION_BENCH_HOST_ORIGIN
    else process.env.VISION_BENCH_HOST_ORIGIN = prev
    unregisterVisionHost()
  }
}

test('runSelfCheck reports structured results without bindings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    await withOrigin('http://127.0.0.1:1', async () => {
      const ran = await runSelfCheck(home, cwd)
      assert.equal(typeof ran.ok, 'boolean')
      assert.ok(Array.isArray(ran.checks))
      const names = ran.checks.map((item) => item.name)
      for (const key of ['bind-python', 'bind-uv4', 'bind-openocd', 'workspace', 'serial-scan', 'host-bridge']) {
        assert.ok(names.includes(key), 'missing check ' + key)
      }
      const workspace = ran.checks.find((item) => item.name === 'workspace')
      assert.equal(workspace.ok, true)
      const binds = ran.checks.filter((item) => item.name.startsWith('bind-'))
      assert.equal(
        binds.every((item) => item.ok === false),
        true,
      )
      assert.ok(ran.capabilities)
      assert.equal(ran.capabilities.keilProject.ready, false)
      assert.equal(typeof ran.requiredOk, 'boolean')
      const host = ran.checks.find((item) => item.name === 'host-bridge')
      assert.equal(host.ok, false)
      assert.equal(ran.hostBridge.available, false)
      assert.equal(ran.requiredOk, false)
      assert.equal(ran.ok, false)
    })
    await stopVisionIoBroker('test')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('runSelfCheck probes a runnable interpreter', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-py-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: process.execPath, uv4: '', openocd: '' })
    await withOrigin('http://127.0.0.1:1', async () => {
      const ran = await runSelfCheck(home, cwd)
      const runs = ran.checks.find((item) => item.name === 'python-runs')
      assert.equal(runs.ok, true)
      const io = ran.checks.find((item) => item.name === 'io-runtime')
      assert.equal(typeof io.ok, 'boolean')
      assert.ok(ran.capabilities)
      assert.equal(typeof ran.capabilities.modbusTcp.ready, 'boolean')
    })
    await stopVisionIoBroker('test')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('in-process Host ping succeeds', async () => {
  const stop = registerVisionHost({
    async dispatch(cmd) {
      assert.equal(cmd.action, 'system.ping')
      return executeVisionCommand({ ...cmd, home: '/tmp' })
    },
  })
  try {
    const ping = await pingVisionHost({ timeoutMs: 2000 })
    assert.equal(ping.ok, true)
    assert.equal(ping.available, true)
    assert.equal(ping.data.service, 'dsh-vision-bench')
    assert.equal(ping.data.transport, 'in-process')
    assert.equal(typeof ping.data.version, 'string')
    assert.equal(ping.data.pid, process.pid)
    assert.ok(ping.data.timestamp)
    assert.ok(ping.roundtripMs >= 0)
  } finally {
    stop()
  }
})

test('HTTP Host ping succeeds and records real roundtrip', async () => {
  const { server, origin } = await listen((req, res) => {
    if (req.method !== 'POST' || req.url !== '/dsh-vision-bench/command') {
      res.writeHead(404)
      res.end()
      return
    }
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          action: 'system.ping',
          data: {
            service: 'dsh-vision-bench',
            version: '0.22.0',
            pid: 4242,
            timestamp: '2026-08-30T00:00:00.000Z',
          },
        }),
      )
    }, 60)
  })
  try {
    const ping = await withOrigin(origin, () => pingVisionHost({ timeoutMs: 2000 }))
    assert.equal(ping.ok, true)
    assert.equal(ping.data.transport, 'http')
    assert.equal(ping.data.pid, 4242)
    assert.ok(ping.roundtripMs >= 40, `expected real latency, got ${ping.roundtripMs}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('Host ping maps refused / timeout / invalid JSON / 401 / 403', async () => {
  const refused = await withOrigin('http://127.0.0.1:1', () => pingVisionHost({ timeoutMs: 500 }))
  assert.equal(refused.ok, false)
  assert.equal(refused.available, false)
  assert.equal(refused.errorCode, 'HOST_UNAVAILABLE')

  const slow = await listen(() => {})
  try {
    const timed = await withOrigin(slow.origin, () => pingVisionHost({ timeoutMs: 80 }))
    assert.equal(timed.ok, false)
    assert.equal(timed.errorCode, 'HOST_TIMEOUT')
    assert.ok(timed.roundtripMs >= 50)
  } finally {
    await new Promise((r) => slow.server.close(r))
  }

  const badJson = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('not-json{')
  })
  try {
    const invalid = await withOrigin(badJson.origin, () => pingVisionHost({ timeoutMs: 1000 }))
    assert.equal(invalid.ok, false)
    assert.equal(invalid.errorCode, 'HOST_INVALID_RESPONSE')
  } finally {
    await new Promise((r) => badJson.server.close(r))
  }

  const unauth = await listen((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'nope' }))
  })
  try {
    const ran = await withOrigin(unauth.origin, () => pingVisionHost({ timeoutMs: 1000 }))
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'HOST_UNAUTHORIZED')
  } finally {
    await new Promise((r) => unauth.server.close(r))
  }

  const forbid = await listen((_req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'nope' }))
  })
  try {
    const ran = await withOrigin(forbid.origin, () => pingVisionHost({ timeoutMs: 1000 }))
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'HOST_FORBIDDEN')
  } finally {
    await new Promise((r) => forbid.server.close(r))
  }
})

test('HTTP Host ping rejects an unrelated server that only returns ok:true', async () => {
  const unrelated = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  try {
    const ran = await withOrigin(unrelated.origin, () => pingVisionHost({ timeoutMs: 1000 }))
    assert.equal(ran.ok, false)
    assert.equal(ran.available, false)
    assert.equal(ran.errorCode, 'HOST_INVALID_RESPONSE')
  } finally {
    await new Promise((r) => unrelated.server.close(r))
  }
})

test('system.ping is side-effect free and self-check uses real availability', async () => {
  const src = readFileSync(join(root, 'src/application/commands/handlers/system-command-handler.mjs'), 'utf8')
  assert.doesNotMatch(src, /serialport|modbus-serial|VisionIoBroker|notifyConnectionRelease|mutateConfig/)
  const checkSrc = readFileSync(join(root, 'bench-check.mjs'), 'utf8')
  assert.doesNotMatch(checkSrc, /push\(\s*['"]host-bridge['"]\s*,\s*true/)
  assert.match(checkSrc, /pingVisionHost/)

  const ping = await executeVisionCommand({ action: 'system.ping', source: 'system', cwd: '' })
  assert.equal(ping.ok, true)
  assert.equal(ping.data.service, 'dsh-vision-bench')
  assert.equal(typeof ping.data.pid, 'number')
})
