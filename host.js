import { randomUUID, timingSafeEqual } from 'node:crypto'
import { stopVisionIoBroker } from './bench-io-broker.mjs'
import { setAgentsRegistry } from './bench-notify.mjs'
import { resetPollingService, stopAllPolling } from './bench-polling-service.mjs'
import { disposeAlarmNotifyRuntime, startAlarmNotifyRuntime } from './src/application/modbus/poll-alarm-notify.mjs'

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
  getSharedDebugRuntime,
  peekSharedDebugRuntime,
  setSharedDebugRuntime,
} from './src/application/debug/debug-runtime.mjs'
import { clearDebugApprovals } from './src/application/debug/debug-approval-service.mjs'
import { clearFlashApprovals } from './src/application/flash/flash-approval-service.mjs'
import { createVerifyCommandService } from './src/application/verify/verify-command-service.mjs'
import { registerVisionHost } from './src/infrastructure/host/vision-host-client.mjs'
import { createAgentPresetAttacher } from './src/infrastructure/host/vision-preset-attach.mjs'
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

/** @type {{ epoch: string, capability: string, debugRuntime: any } | null} */
let activeHostLease = null

const issueBridgeCapability = () => {
  startAlarmNotifyRuntime()
  bridgeCapability = randomUUID()
  process.env.VISION_BENCH_CAPABILITY = bridgeCapability
  return bridgeCapability
}

/**
 * Clear the process-wide bridge capability only when this Host still owns it.
 * @param {string} [expectedCapability]
 * @returns {boolean}
 */
const clearBridgeCapability = (expectedCapability) => {
  if (
    expectedCapability != null &&
    expectedCapability !== '' &&
    bridgeCapability !== '' &&
    bridgeCapability !== expectedCapability
  ) {
    return false
  }
  bridgeCapability = ''
  delete process.env.VISION_BENCH_CAPABILITY
  return true
}

const capabilityMatches = (provided) => {
  if (!bridgeCapability || !provided) return false
  const a = Buffer.from(bridgeCapability)
  const b = Buffer.from(String(provided))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * @param {object} opts
 * @param {string} opts.epoch
 * @param {number} opts.pid
 * @param {boolean} opts.fetch
 * @param {boolean} opts.web
 * @param {boolean} opts.agentBridge
 * @param {boolean} [opts.stale]
 */
function logHostLifecycle(event, opts) {
  console.info(
    JSON.stringify({
      event,
      fiber: name,
      epoch: opts.epoch,
      pid: opts.pid,
      fetch: opts.fetch === true,
      web: opts.web === true,
      agentBridge: opts.agentBridge === true,
      stale: opts.stale === true,
      at: Date.now(),
    }),
  )
}

/**
 * Roll back registrations that happened before shared-lease commit.
 * @param {{
 *   stopFetch?: (() => unknown) | null,
 *   legacyWebCompat?: { stop: () => unknown } | null,
 *   createdSharedRuntime?: boolean,
 *   debugRuntime?: any,
 * }} partial
 */
function rollbackUncommitted(partial) {
  try {
    if (typeof partial.stopFetch === 'function') partial.stopFetch()
  } catch {
    /* ignore */
  }
  try {
    if (partial.legacyWebCompat && typeof partial.legacyWebCompat.stop === 'function') {
      partial.legacyWebCompat.stop()
    }
  } catch {
    /* ignore */
  }
  // First-load only: do not shut down a runtime still owned by a prior Host.
  if (
    partial.createdSharedRuntime === true &&
    partial.debugRuntime &&
    peekSharedDebugRuntime() === partial.debugRuntime
  ) {
    try {
      if (typeof partial.debugRuntime.shutdown === 'function') partial.debugRuntime.shutdown()
    } catch {
      /* ignore */
    }
    setSharedDebugRuntime(null)
  }
}

export function apply(ctx) {
  dshHome = defaultDshHome()

  if (!ctx.connection?.fetch?.register || typeof ctx.connection.fetch.register !== 'function') {
    throw new Error('dsh-vision-bench: Host requires ctx.connection.fetch.register')
  }

  // Phase 1 — local construction only. Do not publish capability / Host / lease yet.
  // Reusing an existing shared DebugRuntime is safe on failed commit; a runtime
  // created in this attempt must be cleared if we never commit a lease.
  const hadSharedRuntime = peekSharedDebugRuntime() != null
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
  const createdSharedRuntime = !hadSharedRuntime
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

  /** @type {(() => void | Promise<void>) | null} */
  let stopFetch = null
  /** @type {{ stop: () => unknown, httpPaths: string[] } | null} */
  let legacyWebCompat = null
  let webMounted = false
  /** @type {(() => void) | null} */
  let stopHost = null
  /** @type {{ epoch: string, capability: string, debugRuntime: any } | null} */
  let lease = null

  /**
   * Bind Web compat to the injected webServer fiber so leave/re-enter remounts cleanly.
   * @param {any} webCtx
   */
  const attachWebCompat = (webCtx) => {
    const effectHost = typeof webCtx?.effect === 'function' ? webCtx : ctx
    effectHost.effect(() => {
      const compat = mountVisionWebCompat({
        connection: webCtx.connection || ctx.connection,
        webServer: webCtx.webServer,
        router,
        dshHome,
        touchSession: (sessionId) => touchServiceSession(sessionId, dshHome),
        capabilityMatches,
        commandDeps: { debugRuntime, verifyCommandService },
      })
      webMounted = true
      return () => {
        webMounted = false
        return compat.stop()
      }
    })
  }

  const attachAgentPreset = createAgentPresetAttacher(ctx, { getHome: () => dshHome })

  try {
    // Fallible registrations first — must not steal the active lease on throw.
    stopFetch = registerVisionFetchDispatch(ctx.connection, router)

    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], attachWebCompat)
      ctx.inject(['agentPresets'], attachAgentPreset)
    } else {
      if (ctx.webServer) {
        legacyWebCompat = mountVisionWebCompat({
          connection: ctx.connection,
          webServer: ctx.webServer,
          router,
          dshHome,
          touchSession: (sessionId) => touchServiceSession(sessionId, dshHome),
          capabilityMatches,
          commandDeps: { debugRuntime, verifyCommandService },
        })
        webMounted = true
      }
      if (ctx.agentPresets) attachAgentPreset(ctx)
    }

    // Phase 2 — commit shared ownership only after fallible mounts succeed.
    const capability = issueBridgeCapability()
    resetPollingService()
    void sweepStaleTasks(dshHome).catch(() => {})
    try {
      setAgentsRegistry(() => (ctx.get ? ctx.get('agents') : null))
    } catch {
      /* agent registry is optional */
    }
    stopHost = registerVisionHost(commandDispatcher)
    lease = {
      epoch: randomUUID(),
      capability,
      debugRuntime,
    }
    activeHostLease = lease
  } catch (error) {
    rollbackUncommitted({
      stopFetch,
      legacyWebCompat,
      createdSharedRuntime,
      debugRuntime,
    })
    console.info(
      JSON.stringify({
        event: 'vision.host.apply-failed',
        fiber: name,
        pid: process.pid,
        error: String(error && /** @type {Error} */ (error).message ? error.message : error).slice(0, 300),
        activeEpoch: activeHostLease?.epoch ?? null,
        at: Date.now(),
      }),
    )
    throw error
  }

  logHostLifecycle('vision.host.start', {
    epoch: lease.epoch,
    pid: process.pid,
    fetch: true,
    web: webMounted,
    agentBridge: webMounted,
  })

  let isHostDisposed = false
  let loggedStaleDispose = false
  ctx.effect(() => () => {
    if (isHostDisposed) return
    isHostDisposed = true

    const isCurrentLease = activeHostLease?.epoch === lease.epoch
    const stale = !isCurrentLease

    logHostLifecycle('vision.host.stop', {
      epoch: lease.epoch,
      pid: process.pid,
      fetch: true,
      web: webMounted,
      agentBridge: webMounted,
      stale,
    })

    const fetchStop =
      typeof stopFetch === 'function'
        ? Promise.resolve()
            .then(() => stopFetch())
            .catch(() => {})
        : Promise.resolve()
    const webStop = legacyWebCompat ? legacyWebCompat.stop() : Promise.resolve()
    try {
      if (typeof stopHost === 'function') stopHost()
    } catch {
      /* ignore */
    }

    if (stale) {
      if (!loggedStaleDispose) {
        loggedStaleDispose = true
        console.info(
          JSON.stringify({
            event: 'vision.host.stale-dispose',
            fiber: name,
            epoch: lease.epoch,
            activeEpoch: activeHostLease?.epoch ?? null,
            pid: process.pid,
            at: Date.now(),
          }),
        )
      }
      return Promise.allSettled([fetchStop, Promise.resolve(webStop)])
    }

    clearBridgeCapability(lease.capability)
    clearSerialMonitorState()
    stopAllPolling()
    clearFlashApprovals()
    clearDebugApprovals()
    disposeAlarmNotifyRuntime()
    const brokerStop = stopVisionIoBroker('plugin-dispose')
    const runtimeStop =
      peekSharedDebugRuntime() === lease.debugRuntime
        ? lease.debugRuntime.shutdown('plugin-dispose').catch(() => {})
        : Promise.resolve()
    if (peekSharedDebugRuntime() === lease.debugRuntime) {
      setSharedDebugRuntime(null)
    }
    if (activeHostLease?.epoch === lease.epoch) {
      activeHostLease = null
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
  getActiveHostLease: () => activeHostLease,
  snapshot: (cwd) => createVisionRpcRouter({ getHome: () => dshHome }).snapshot(cwd),
  dispatchRpc: (endpoint, payload, signal) =>
    createVisionRpcRouter({ getHome: () => dshHome }).dispatch(endpoint, payload, signal),
  cwdOf,
  journalView,
}
