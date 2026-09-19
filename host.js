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
import {
  createDebugRuntime,
  getSharedDebugRuntime,
  peekSharedDebugRuntime,
  setSharedDebugRuntime,
} from './src/application/debug/debug-runtime.mjs'
import { clearDebugApprovals } from './src/application/debug/debug-approval-service.mjs'
import { clearFlashApprovals } from './src/application/flash/flash-approval-service.mjs'
import { createVerifyCommandService } from './src/application/verify/verify-command-service.mjs'
import { registerVisionHost } from './src/infrastructure/host/vision-host-client.mjs'
import { createVerifyTelemetryAdapter } from './src/infrastructure/modbus/verify-telemetry-adapter.mjs'
import { registerVisionFetchDispatch } from './src/interfaces/fetch/vision-fetch-route.mjs'
import { createVisionCommandDispatcher } from './src/interfaces/http/vision-command-routes.mjs'
import { createVisionRpcRouter } from './src/interfaces/rpc/vision-rpc-router.mjs'
import { mountVisionWebCompat } from './src/interfaces/web/vision-web-compat.mjs'

export const name = 'dsh-vision-bench'
// Host fiber: connection only. Web RPC + Agent HTTP bridge mount under optional webServer.
// Agent tools live in tools.js under a different loader name.
export const inject = ['connection']

let bridgeCapability = ''
let dshHome = defaultDshHome()

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

export function apply(ctx) {
  dshHome = defaultDshHome()

  if (!ctx.connection?.fetch?.register || typeof ctx.connection.fetch.register !== 'function') {
    throw new Error('dsh-vision-bench: Host requires ctx.connection.fetch.register')
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
    home: dshHome,
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
  console.info(
    JSON.stringify({
      event: 'vision.host.start',
      fiber: name,
      pid: process.pid,
      at: Date.now(),
    }),
  )

  const hostEpoch = { id: randomUUID(), disposed: false }
  const stopFetch = registerVisionFetchDispatch(ctx.connection, router)

  /** @type {{ stop: () => unknown, httpPaths: string[] } | null} */
  let webCompat = null
  const mountWeb = (webCtx) => {
    webCompat = mountVisionWebCompat({
      connection: webCtx.connection || ctx.connection,
      webServer: webCtx.webServer,
      router,
      dshHome,
      touchSession: (sessionId) => touchServiceSession(sessionId, dshHome),
      capabilityMatches,
      commandDeps: { debugRuntime, verifyCommandService },
    })
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], mountWeb)
  } else if (ctx.webServer) {
    // Unit-test hosts without Cordis inject still expose webServer on ctx.
    mountWeb(ctx)
  }

  let isHostDisposed = false
  ctx.effect(() => () => {
    if (isHostDisposed) return
    isHostDisposed = true
    hostEpoch.disposed = true
    const fetchStop =
      typeof stopFetch === 'function'
        ? Promise.resolve()
            .then(() => stopFetch())
            .catch(() => {})
        : Promise.resolve()
    const webStop = webCompat ? webCompat.stop() : Promise.resolve()
    try {
      stopHost()
    } catch {
      /* ignore */
    }
    clearBridgeCapability()
    clearSerialMonitorState()
    stopAllPolling()
    clearFlashApprovals()
    clearDebugApprovals()
    const brokerStop = stopVisionIoBroker('plugin-dispose')
    // Use peek — getSharedDebugRuntime() would recreate a singleton after clear.
    const runtimeStop =
      peekSharedDebugRuntime() === debugRuntime
        ? debugRuntime.shutdown('plugin-dispose').catch(() => {})
        : Promise.resolve()
    if (peekSharedDebugRuntime() === debugRuntime) {
      setSharedDebugRuntime(null)
    }
    return Promise.allSettled([fetchStop, Promise.resolve(webStop), brokerStop, runtimeStop])
  })
}

export const _internal = {
  setDshHome(dir) {
    dshHome = dir
  },
  getDshHome() {
    return dshHome
  },
  issueBridgeCapability,
  clearBridgeCapability,
  capabilityMatches,
  snapshot: (cwd) => createVisionRpcRouter({ getHome: () => dshHome }).snapshot(cwd),
  dispatchRpc: (endpoint, payload, signal) =>
    createVisionRpcRouter({ getHome: () => dshHome }).dispatch(endpoint, payload, signal),
  cwdOf,
  journalView,
}
