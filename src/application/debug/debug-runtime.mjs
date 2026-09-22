// @ts-check
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { TargetLeaseManager } from '../../domain/debug/target-lease.mjs'
import { executeDebugCommand } from './debug-command-executor.mjs'
import { createDebugRuntimeLifecycle } from './debug-runtime-lifecycle.mjs'
import { createDebugSessionRegistry } from './debug-session-registry.mjs'

/**
 * Creates the host authoritative DebugRuntime service shell.
 * Parity with ADR-013 & Phase 2 application architecture.
 *
 * Single state authority: registry holds sessions; lifecycle mutates them;
 * this facade exposes the public API without owning storage maps itself.
 *
 * @param {{
 *   leaseManager?: TargetLeaseManager,
 *   backendFactory?: (backendKind: import('../../types/debug.d.ts').DebugBackendKind, ctx: any) => Promise<any>,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
 *   home?: string,
 * }} [deps]
 */
export function createDebugRuntime(deps = {}) {
  const leaseManager = deps.leaseManager || new TargetLeaseManager()
  const backendFactory =
    deps.backendFactory ||
    (async (kind, ctx) => {
      if (kind === 'keil-simulator') {
        const { KeilSimBackend } = await import('../../infrastructure/debug/keil/keil-sim-backend.mjs')
        return new KeilSimBackend(ctx)
      }
      if (kind === 'gdb-openocd') {
        const { GdbBackend } = await import('../../infrastructure/debug/gdb-mi/gdb-backend.mjs')
        return new GdbBackend(ctx)
      }
      throw new DebugError(DEBUG_ERRORS.BACKEND_UNAVAILABLE, `调试后端暂不可用: ${kind}`)
    })
  const onJournalEvent = deps.onJournalEvent || null
  const home = String(deps.home || '').trim()

  const registry = createDebugSessionRegistry()
  const lifecycle = createDebugRuntimeLifecycle({
    registry,
    leaseManager,
    backendFactory,
    onJournalEvent,
    home,
  })

  return {
    getLeaseManager() {
      return leaseManager
    },

    start: lifecycle.start,
    stop: lifecycle.stop,
    shutdown: lifecycle.shutdown,

    /**
     * @param {{ debugSessionId: string, ownerSessionId: string }} scope
     * @param {{ type: string, [key: string]: any }} command
     */
    async command(scope, command) {
      const session = registry.requireSession(scope)
      return executeDebugCommand(session, command, { onJournalEvent })
    },

    /**
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @returns {import('../../types/debug.d.ts').DebugSessionView}
     */
    state(scope) {
      const session = registry.requireSession({
        debugSessionId: scope.debugSessionId,
        ownerSessionId: scope.ownerSessionId || '',
      })
      return registry.toView(session)
    },

    getFailedSession: registry.getFailedSession,
    listFailedSessions: registry.listFailedSessions,
    findOwnedSession: registry.findOwnedSession,
    findSession: registry.findSession,
    listSessions: registry.listSessions,
    waitForOwnerSession: registry.waitForOwnerSession,

    /**
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @param {number} [afterCursor=0]
     * @param {number} [limit=100]
     * @returns {{ events: import('../../types/debug.d.ts').DebugEvent[], nextCursor: number, cursorExpired: boolean }}
     */
    getEvents(scope, afterCursor = 0, limit = 100) {
      const session = registry.requireSession({
        debugSessionId: scope.debugSessionId,
        ownerSessionId: scope.ownerSessionId || '',
      })
      return session.eventRing.getEventsAfter(afterCursor, limit)
    },

    /**
     * @param {{ debugSessionId: string, ownerSessionId?: string }} scope
     * @param {number} [afterCursor=0]
     * @param {AbortSignal | { signal?: AbortSignal, timeoutMs?: number }} [options]
     */
    async waitEvents(scope, afterCursor = 0, options = {}) {
      const session = registry.requireSession({
        debugSessionId: scope.debugSessionId,
        ownerSessionId: scope.ownerSessionId || '',
      })
      const waitOpts = options instanceof AbortSignal ? { signal: options } : options || {}
      return await session.eventRing.waitForEventsAfter(afterCursor, waitOpts)
    },
  }
}

/** @type {ReturnType<typeof createDebugRuntime> | null} */
let defaultSharedDebugRuntime = null

/**
 * Gets or initializes the singleton DebugRuntime for the current host lifecycle.
 * @param {Parameters<typeof createDebugRuntime>[0]} [deps]
 * @returns {ReturnType<typeof createDebugRuntime>}
 */
export function getSharedDebugRuntime(deps = {}) {
  if (!defaultSharedDebugRuntime) {
    defaultSharedDebugRuntime = createDebugRuntime(deps)
  }
  return defaultSharedDebugRuntime
}

/** @returns {ReturnType<typeof createDebugRuntime> | null} */
export function peekSharedDebugRuntime() {
  return defaultSharedDebugRuntime
}

/**
 * Sets or clears the shared DebugRuntime (used in host lifecycle or testing).
 * @param {ReturnType<typeof createDebugRuntime> | null} [runtime]
 */
export function setSharedDebugRuntime(runtime = null) {
  defaultSharedDebugRuntime = runtime
}
