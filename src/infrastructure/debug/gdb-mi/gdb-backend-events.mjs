// @ts-check

import { mapGdbStopReason } from './stop-reason.mjs'

/**
 * Frame → SourceLocation projection for GDB/MI async stop records.
 * @param {any} frame
 * @returns {import('../../../types/debug.d.ts').SourceLocation | undefined}
 */
export function decodeGdbFrameLocation(frame) {
  if (!frame) return undefined
  return {
    file: frame.file || frame.fullname || '',
    line: Number(frame.line || 0),
    function: frame.func || '',
    address: frame.addr || '',
  }
}

/**
 * Decodes a GDB/MI async record into a canonical backend event (+ side-effect hints).
 * @param {import('./mi-record.mjs').MIRecord} rec
 * @returns {{
 *   event: import('../../../types/debug-backend.d.ts').DebugBackendEvent | null,
 *   nativeState?: 'paused' | 'running',
 *   location?: import('../../../types/debug.d.ts').SourceLocation,
 * }}
 */
export function decodeGdbAsyncRecord(rec) {
  if (rec.class === 'stopped') {
    const reason = mapGdbStopReason(rec)
    const loc = decodeGdbFrameLocation(rec.results?.frame)
    return {
      nativeState: 'paused',
      location: loc,
      event: {
        type: 'backend.stopped',
        reason,
        location: loc,
        nativeReason: rec.results?.reason,
        breakpointNumber: rec.results?.bkptno ? String(rec.results.bkptno) : undefined,
        watchpointNumber:
          rec.results?.wpt?.number || rec.results?.wpt
            ? String(rec.results?.wpt?.number || rec.results?.wpt)
            : undefined,
        threadId: rec.results?.['thread-id'],
      },
    }
  }
  if (rec.class === 'running') {
    return {
      nativeState: 'running',
      event: {
        type: 'backend.running',
        threadId: rec.results?.['thread-id'],
      },
    }
  }
  return { event: null }
}

/**
 * Decodes a GDB/MI stream record into a backend.console event.
 * @param {{ kind?: string, text?: string }} rec
 * @returns {import('../../../types/debug-backend.d.ts').DebugBackendEvent}
 */
export function decodeGdbStreamRecord(rec) {
  let stream = 'console'
  if (rec.kind === 'target-stream') stream = 'target'
  else if (rec.kind === 'log-stream') stream = 'log'
  return {
    type: 'backend.console',
    stream: /** @type {'console' | 'target' | 'log'} */ (stream),
    text: rec.text || '',
  }
}

/**
 * Creates emit helpers bound to a listener set and exit-once latch.
 * @param {{
 *   listeners: Set<(event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void>,
 *   getExitEmitted: () => boolean,
 *   setExitEmitted: (v: boolean) => void,
 * }} ctx
 */
export function createGdbEventEmitter(ctx) {
  /**
   * @param {import('../../../types/debug-backend.d.ts').DebugBackendEvent} event
   */
  function emit(event) {
    for (const listener of ctx.listeners) {
      try {
        listener(event)
      } catch {
        /* ignore listener error */
      }
    }
  }

  /**
   * @param {import('../../../types/debug-backend.d.ts').DebugBackendEvent} event
   */
  function emitExitOnce(event) {
    if (ctx.getExitEmitted()) return
    ctx.setExitEmitted(true)
    emit(event)
  }

  return { emit, emitExitOnce }
}

/**
 * Wires MI async + stream listeners onto a backend context.
 * @param {{
 *   miClient: import('./mi-client.mjs').MIClient,
 *   isStopping: boolean,
 *   _emit: (event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void,
 *   _emitExitOnce: (event: import('../../../types/debug-backend.d.ts').DebugBackendEvent) => void,
 *   nativeState: string,
 *   lastNativeLocation: import('../../../types/debug.d.ts').SourceLocation | null,
 * }} backend
 * @returns {{ unsubscribeAsync: (() => void) | null, unsubscribeStream: (() => void) | null }}
 */
export function wireGdbMiListeners(backend) {
  const unsubscribeAsync = backend.miClient.onAsync((rec) => {
    const decoded = decodeGdbAsyncRecord(rec)
    if (!decoded.event) return
    if (decoded.nativeState) backend.nativeState = decoded.nativeState
    if (decoded.location) backend.lastNativeLocation = decoded.location
    backend._emit(decoded.event)
  })

  /** @type {(() => void) | null} */
  let unsubscribeStream = null
  if (typeof backend.miClient.onStream === 'function') {
    unsubscribeStream = backend.miClient.onStream((rec) => {
      backend._emit(decodeGdbStreamRecord(rec))
    })
  }

  if (backend.miClient._transport?.exitPromise) {
    backend.miClient._transport.exitPromise.then(
      (exitInfo) => {
        backend._emitExitOnce({
          type: 'backend.exited',
          code: exitInfo?.code ?? undefined,
          signal: exitInfo?.signal ?? undefined,
          unexpected: !backend.isStopping,
        })
      },
      (err) => {
        backend._emit({
          type: 'backend.error',
          message: err instanceof Error ? err.message : String(err),
          fatal: true,
        })
      },
    )
  }

  return { unsubscribeAsync, unsubscribeStream }
}
