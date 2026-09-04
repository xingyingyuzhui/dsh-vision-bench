import { randomUUID, timingSafeEqual } from 'node:crypto'
import { stopVisionIoBroker } from './bench-io-broker.mjs'
import { setAgentsRegistry } from './bench-notify.mjs'
import { stopAllPolling } from './bench-polling-service.mjs'
import { VISION_GUIDANCE, seedVisionBenchPreset } from './bench-preset.mjs'
import { clearSerialMonitorState } from './bench-serial-monitor.mjs'
import { defaultDshHome, journalView, sweepStaleTasks, touchServiceSession } from './bench-store.mjs'
import { cwdOf, visionBenchTool } from './bench-tool.mjs'
import { toLosslessJson } from './src/application/commands/lossless-json.mjs'
import {
  createDebugRuntime,
  getSharedDebugRuntime,
  setSharedDebugRuntime,
} from './src/application/debug/debug-runtime.mjs'
import { clearFlashApprovals } from './src/application/flash/flash-approval-service.mjs'
import { registerVisionHost } from './src/infrastructure/host/vision-host-client.mjs'
import { visionDebugTool } from './src/interfaces/agent/vision-debug-tool.mjs'
import { createVisionCommandDispatcher, handleCommand } from './src/interfaces/http/vision-command-routes.mjs'
import { createVisionRpcRouter } from './src/interfaces/rpc/vision-rpc-router.mjs'
import { VISION_RPC_CHANNEL } from './src/shared/vision-rpc-contract.mjs'

export const name = 'dsh-vision-bench'
export const inject = ['connection', 'webServer', 'tools', 'agentPresets', 'systemPrompt']

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
const CAPABILITY_HEADER = 'x-dsh-vision-capability'
let bridgeCapability = ''

let dshHome = defaultDshHome()

const writeJson = (res, status, body) => {
  const payload = toLosslessJson(body)
  const safe = payload === undefined ? { ok: false, error: '响应无法序列化为 JSON' } : payload
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(safe))
}

const readJsonBody = (req, cap = BODY_CAP) =>
  new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })

const issueBridgeCapability = () => {
  bridgeCapability = randomUUID()
  process.env.VISION_BENCH_CAPABILITY = bridgeCapability
  return bridgeCapability
}

const clearBridgeCapability = () => {
  bridgeCapability = ''
  delete process.env.VISION_BENCH_CAPABILITY
}

const capabilityMatches = (provided) => {
  if (!bridgeCapability || !provided) return false
  const a = Buffer.from(bridgeCapability)
  const b = Buffer.from(String(provided))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const readBodyAndTouchSession = async (req) => {
  const body = await readJsonBody(req)
  const sessionId = body && typeof body === 'object' && body.sessionId ? String(body.sessionId) : ''
  if (sessionId) {
    touchServiceSession(sessionId, dshHome)
  }
  return body
}

function isLoopbackAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

function socketAddress(req) {
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || ''
}

const guard = (req, res) => {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }
  if (!isLoopbackAddress(socketAddress(req))) {
    writeJson(res, 403, { ok: false, error: 'loopback only' })
    return false
  }
  const headers = (req && req.headers) || {}
  const origin = headers.origin || headers.Origin
  if (origin && !LOOPBACK_ORIGIN.test(origin)) {
    writeJson(res, 403, { ok: false, error: 'forbidden origin' })
    return false
  }
  const ctype = String(headers['content-type'] || headers['Content-Type'] || '')
  if (ctype && !/^application\/json\b/i.test(ctype)) {
    writeJson(res, 415, { ok: false, error: 'content-type must be application/json' })
    return false
  }
  const cap = headers[CAPABILITY_HEADER] || headers['X-DSH-Vision-Capability'] || ''
  if (!cap) {
    writeJson(res, 403, { ok: false, error: 'missing capability' })
    return false
  }
  if (!capabilityMatches(cap)) {
    writeJson(res, 403, { ok: false, error: 'invalid capability' })
    return false
  }
  return true
}

const respond = async (req, res, fn) => {
  try {
    const body = await fn()
    writeJson(res, 200, body)
  } catch (error) {
    writeJson(res, 200, { ok: false, error: String((error && error.message) || error).slice(0, 300) })
  }
}

const commandRoute = (path, fn) => ({
  kind: 'exact',
  path,
  handler: (req, res) => {
    if (!guard(req, res)) return
    respond(req, res, () => fn(req))
  },
})

export function apply(ctx, config = {}) {
  dshHome = defaultDshHome()
  const role = config.role === 'agent' ? 'agent' : 'host'
  if (role === 'agent') {
    const stopBenchTool = ctx.tools.register(visionBenchTool(dshHome))
    const stopDebugTool = ctx.tools.register(visionDebugTool(dshHome))
    let stopGuidance = () => {}
    try {
      if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
        stopGuidance =
          ctx.systemPrompt.section({
            name: 'vision-bench:guidance',
            order: 20,
            text: () => VISION_GUIDANCE,
          }) || (() => {})
      }
    } catch {}
    ctx.effect(() => () => {
      if (typeof stopBenchTool === 'function') stopBenchTool()
      if (typeof stopDebugTool === 'function') stopDebugTool()
      if (typeof stopGuidance === 'function') stopGuidance()
    })
    return
  }

  if (!ctx.connection?.rpc?.handle || typeof ctx.connection.rpc.handle !== 'function') {
    throw new Error('dsh-vision-bench: Host requires ctx.connection.rpc.handle')
  }

  issueBridgeCapability()
  void sweepStaleTasks(dshHome).catch(() => {})
  try {
    setAgentsRegistry(() => (ctx.get ? ctx.get('agents') : null))
  } catch {
    /* agent registry is optional */
  }

  const debugRuntime = getSharedDebugRuntime()
  const router = createVisionRpcRouter({ getHome: () => dshHome, debugRuntime })
  const commandDispatcher = createVisionCommandDispatcher(dshHome)
  const stopHost = registerVisionHost(commandDispatcher)

  let stopRpc = () => Promise.resolve()
  const stopRpcRegistration = ctx.connection.rpc.handle(VISION_RPC_CHANNEL, async (endpoint, payload, signal) => {
    try {
      const value = await router.dispatch(endpoint, payload, signal)
      return { ok: true, value }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: String((error && error.message) || error).slice(0, 300),
          details: {},
        },
      }
    }
  })
  if (typeof stopRpcRegistration === 'function') {
    stopRpc = stopRpcRegistration
  } else if (stopRpcRegistration && typeof stopRpcRegistration.then === 'function') {
    stopRpcRegistration.then((dispose) => {
      if (typeof dispose === 'function') stopRpc = dispose
    })
  }

  const rows = [
    commandRoute('/dsh-vision-bench/command', async (req) => handleCommand(dshHome, req, readBodyAndTouchSession)),
  ]
  const disposers = rows.map((entry) => ctx.webServer.register(entry))

  void seedVisionBenchPreset(ctx.agentPresets, dshHome)
    .then((out) => {
      if (out && out.ok === false) {
        console.warn('[dsh-vision-bench] Vision预设未更新:', out.error || 'overlay failed')
      }
    })
    .catch((error) => {
      console.warn('[dsh-vision-bench] Vision预设未更新:', error && error.message ? error.message : error)
    })

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    void stopRpc()
    stopHost()
    clearBridgeCapability()
    clearSerialMonitorState()
    stopAllPolling()
    clearFlashApprovals()
    void stopVisionIoBroker('plugin-dispose')
    void debugRuntime.shutdown('plugin-dispose').catch(() => {})
    setSharedDebugRuntime(null)
  })
}

export const _internal = {
  setDshHome(dir) {
    dshHome = dir
  },
  getDshHome() {
    return dshHome
  },
  guard,
  issueBridgeCapability,
  clearBridgeCapability,
  snapshot: (cwd) => createVisionRpcRouter({ getHome: () => dshHome }).snapshot(cwd),
  dispatchRpc: (endpoint, payload, signal) =>
    createVisionRpcRouter({ getHome: () => dshHome }).dispatch(endpoint, payload, signal),
  cwdOf,
  journalView,
}
