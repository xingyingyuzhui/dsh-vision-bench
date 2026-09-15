// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
import { UV_OPERATION } from './uvsock-client.mjs'

/**
 * Emits a backend event to all registered listeners.
 * @param {Set<(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void>} listeners
 * @param {import('../../../types/debug-backend.d.ts').DebugBackendEvent} event
 */
export function emitKeilBackendEvent(listeners, event) {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* ignore listener error */
    }
  }
}

/**
 * Pushes a product debug event onto the optional event ring.
 * @param {{
 *   eventRing?: { push: (event: any) => any } | null,
 *   debugSessionId: string,
 *   ownerSessionId: string,
 *   workspaceCwd: string,
 * }} ctx
 * @param {string} type
 * @param {any} [payload]
 */
export function pushKeilRingEvent(ctx, type, payload) {
  if (!ctx.eventRing) return
  ctx.eventRing.push({
    debugSessionId: ctx.debugSessionId,
    ownerSessionId: ctx.ownerSessionId,
    workspaceCwd: ctx.workspaceCwd,
    timestamp: Date.now(),
    type,
    backend: 'keil-simulator',
    payload,
  })
}

/**
 * Maps UVSOCK async stop text to a canonical BackendStopReason.
 * @param {string} rawReason
 * @returns {import('../../../types/debug-backend.d.ts').BackendStopReason}
 */
export function mapKeilStopReason(rawReason) {
  if (rawReason.includes('breakpoint')) return 'breakpoint'
  if (rawReason.includes('watchpoint')) return 'watchpoint'
  if (rawReason.includes('step')) return 'step'
  if (rawReason.includes('signal')) return 'signal'
  return 'pause'
}

/**
 * Handles UVSOCK async events and projects to backend + ring events.
 * @param {any} backend KeilSimBackend instance
 * @param {any} ev
 */
export function handleKeilAsyncEvent(backend, ev) {
  const isStop =
    ev.type === 'stop_execution' ||
    ev.cmd === UV_OPERATION.UV_DBG_STOP_EXECUTION ||
    (ev.type === 'async_response' && ev.cmd === UV_OPERATION.UV_DBG_STOP_EXECUTION) ||
    ev.opcode === UV_OPERATION.UV_DBG_STOP_EXECUTION

  if (isStop) {
    backend.state = 'paused'
    const rawReason = String(ev.text || ev.details?.error?.message || ev.details?.message || 'stop')
    const reason = mapKeilStopReason(rawReason)

    pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.PAUSED, {
      reason: rawReason,
      location: backend.currentLocation,
      watchpointExpression: ev.watchpointExpression,
    })

    emitKeilBackendEvent(backend.listeners, {
      type: 'backend.stopped',
      reason,
      location: backend.currentLocation || undefined,
      nativeReason: rawReason,
    })
    return
  }

  if (ev.type === 'build_output' || ev.cmd === UV_OPERATION.UV_DBG_CMD_OUTPUT) {
    emitKeilBackendEvent(backend.listeners, {
      type: 'backend.console',
      stream: 'target',
      text: ev.text || '',
    })
  }
}
