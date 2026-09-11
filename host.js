import { randomUUID, timingSafeEqual } from 'node:crypto'
import { stopVisionIoBroker } from './bench-io-broker.mjs'
import { setAgentsRegistry } from './bench-notify.mjs'
import { resetPollingService, stopAllPolling } from './bench-polling-service.mjs'

import { clearSerialMonitorState } from './bench-serial-monitor.mjs'
import { modbusRead } from './bench-actions.mjs'
import {
  defaultDshHome,
  journalView,
  loadWorkspace,
  recordBenchEvent,
  sweepStaleTasks,
  touchServiceSession,
} from './bench-store.mjs'
import { cwdOf } from './bench-tool.mjs'
import { toLosslessJson } from './src/application/commands/lossless-json.mjs'
import {
  createDebugRuntime,
  getSharedDebugRuntime,
  setSharedDebugRuntime,
} from './src/application/debug/debug-runtime.mjs'
import { clearDebugApprovals } from './src/application/debug/debug-approval-service.mjs'
import { clearFlashApprovals } from './src/application/flash/flash-approval-service.mjs'
import { createVerifyCommandService } from './src/application/verify/verify-command-service.mjs'
import { registerVisionHost } from './src/infrastructure/host/vision-host-client.mjs'
import { createVerifyTelemetryAdapter } from './src/infrastructure/modbus/verify-telemetry-adapter.mjs'
import { createVisionCommandDispatcher, handleCommand } from './src/interfaces/http/vision-command-routes.mjs'
import { createVisionRpcRouter } from './src/interfaces/rpc/vision-rpc-router.mjs'
import { VISION_RPC_CHANNEL } from './src/shared/vision-rpc-contract.mjs'

export const name = 'dsh-vision-bench'
// Host fiber only: connection + webServer. Agent tools live in tools.js
// under a different loader name so session preset mount does not dirty this
// package's 1.5MB client bundle.
export const inject = ['connection', 'webServer']

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

export function apply(ctx) {
  dshHome = defaultDshHome()

  if (!ctx.connection?.rpc?.handle || typeof ctx.connection.rpc.handle !== 'function') {
    throw new Error('dsh-vision-bench: Host requires ctx.connection.rpc.handle')
  }

  issueBridgeCapability()
  resetPollingService()
  void sweepStaleTasks(dshHome).catch(() => {})
  try {
    setAgentsRegistry(() => (ctx.get ? ctx.get('agents') : null))
  } catch {
    /* agent registry is optional */
  }

  const debugRuntime = getSharedDebugRuntime({
    onJournalEvent: async (ev) => {
      if (!ev || !ev.cwd) return
      await recordBenchEvent(
        dshHome,
        ev.cwd,
        {
          action: ev.action,
          ok: ev.ok !== false,
          summary: ev.summary || `调试事件: ${ev.action}`,
        },
        {
          sessionId: ev.sessionId || '',
          source: ev.source || 'system',
        },
      ).catch(() => {})
    },
  })
  const telemetryReader = createVerifyTelemetryAdapter({
    getHome: () => dshHome,
    workspaceLoader: (cwd) => loadWorkspace(dshHome, cwd),
    modbusReadFn: (home, cwd, body, opts) => modbusRead(home, cwd, body, opts),
  })
  const verifyCommandService = createVerifyCommandService({
    debugRuntime,
    telemetryReader,
    workspaceLoader: (cwd) => loadWorkspace(dshHome, cwd),
    onJournalEvent: async (ev) => {
      if (!ev || !ev.cwd) return
      await recordBenchEvent(
        dshHome,
        ev.cwd,
        {
          action: ev.action,
          ok: ev.ok !== false,
          summary: ev.summary || `验证事件: ${ev.action}`,
        },
        {
          sessionId: ev.sessionId || '',
          source: 'system',
        },
      ).catch(() => {})
    },
  })
  const router = createVisionRpcRouter({ getHome: () => dshHome, debugRuntime, verifyCommandService })
  const commandDispatcher = createVisionCommandDispatcher(dshHome, { debugRuntime, verifyCommandService })
  const stopHost = registerVisionHost(commandDispatcher)

  const hostEpoch = { id: randomUUID(), disposed: false }

  // Pass the plugin context explicitly so RPC routes retain its webServer injection.
  const registerRpc =
    typeof ctx.connection.register === 'function'
      ? (channel, handler) => ctx.connection.register(ctx, channel, handler)
      : (channel, handler) => ctx.connection.rpc.handle(channel, handler)

  const stopRpcRegistration = registerRpc(VISION_RPC_CHANNEL, async (endpoint, payload, signal) => {
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
  const rpcRegistration = Promise.resolve(
    typeof stopRpcRegistration === 'function'
      ? stopRpcRegistration
      : stopRpcRegistration && typeof stopRpcRegistration.then === 'function'
        ? stopRpcRegistration
        : () => Promise.resolve(),
  )
  let rpcStopPromise = null
  const safeStopRpc = () => {
    if (!rpcStopPromise) {
      rpcStopPromise = rpcRegistration
        .then((dispose) => (typeof dispose === 'function' ? dispose() : undefined))
        .catch(() => {})
    }
    return rpcStopPromise
  }
  rpcRegistration.then(() => {
    if (hostEpoch.disposed) safeStopRpc()
  })

  const rows = [
    commandRoute('/dsh-vision-bench/command', async (req) =>
      handleCommand(dshHome, req, readBodyAndTouchSession, { debugRuntime, verifyCommandService }),
    ),
  ]
  const disposers = rows.map((entry) => ctx.webServer.register(entry))

  let routesDisposed = false
  const safeStopRoutes = () => {
    if (routesDisposed) return
    routesDisposed = true
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch (_) {}
    }
  }

  let isHostDisposed = false
  ctx.effect(() => () => {
    if (isHostDisposed) return
    isHostDisposed = true
    hostEpoch.disposed = true
    safeStopRoutes()
    const rpcStop = safeStopRpc()
    try {
      stopHost()
    } catch (_) {}
    clearBridgeCapability()
    clearSerialMonitorState()
    stopAllPolling()
    clearFlashApprovals()
    clearDebugApprovals()
    const brokerStop = stopVisionIoBroker('plugin-dispose')
    const runtimeStop =
      getSharedDebugRuntime() === debugRuntime
        ? debugRuntime.shutdown('plugin-dispose').catch(() => {})
        : Promise.resolve()
    if (getSharedDebugRuntime() === debugRuntime) {
      setSharedDebugRuntime(null)
    }
    return Promise.allSettled([rpcStop, brokerStop, runtimeStop])
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
