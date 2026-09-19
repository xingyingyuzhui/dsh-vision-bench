// @ts-check

import { beginRequest, shouldApplyRequest } from '../../common/latest-request-gate.mjs'
import { projectDebugEvents } from './debug-event-projection.mjs'

/** Consecutive wait/state failures before the loop stops (no plugin-tree reload). */
export const DEBUG_WAIT_FAILURE_BUDGET = 5

/** Exponential backoff after transport/business wait failures (ms). */
export const DEBUG_WAIT_BACKOFF_MS = Object.freeze([1000, 2000, 4000, 8000, 16000])

/**
 * @param {number} consecutiveFailures 1-based failure count
 * @returns {number}
 */
export function debugWaitBackoffMs(consecutiveFailures) {
  const n = Math.max(1, Number(consecutiveFailures) || 1)
  const idx = Math.min(n - 1, DEBUG_WAIT_BACKOFF_MS.length - 1)
  return DEBUG_WAIT_BACKOFF_MS[idx]
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/**
 * Starts the ADR-014 cursor long-poll subscription for debug events.
 * Returns a cleanup function that aborts the poll and marks the effect stopped.
 *
 * State machine:
 * - No chat `sessionId`/`cwd` → idle, zero requests.
 * - Identity present, no debug session → `debug/events/wait` → Host `waitForOwnerSession`
 *   (20–25s hang; no 1Hz poll). Timeout re-hangs.
 * - `woke` → refresh state → active event wait.
 * - `closed` → clear local session → back to owner-session discovery.
 * - Failures back off 1s→2s→4s→8s→16s then stop with a retry error (no plugin reload).
 *
 * @param {{
 *   React: any,
 *   controller: ReturnType<typeof import('./runtime-controller.mjs').createRuntimeController>,
 *   identityKey: string,
 *   sessionId: string,
 *   cwd: string,
 *   reqRef: { current: number },
 *   mountedRef: { current: boolean },
 *   abortRef: { current: AbortController | null },
 *   cursorRef: { current: number },
 *   watchesRef: { current: string[] },
 *   applyState: (data: any) => void,
 *   refreshRegisters: () => Promise<void>,
 *   evaluateWatches: (watchList: string[], frame?: number) => Promise<void>,
 *   setLoading: (v: boolean) => void,
 *   setError: (v: any) => void,
 *   setEvents: (updater: any) => void,
 *   setStatus: (s: string) => void,
 *   setPendingControl: (v: any) => void,
 *   setActive: (v: boolean) => void,
 * }} ctx
 * @returns {() => void}
 */
export function startDebugEventSubscription(ctx) {
  const {
    controller,
    identityKey,
    sessionId,
    cwd,
    reqRef,
    mountedRef,
    abortRef,
    cursorRef,
    watchesRef,
    applyState,
    refreshRegisters,
    evaluateWatches,
    setLoading,
    setError,
    setEvents,
    setStatus,
    setPendingControl,
    setActive,
  } = ctx

  mountedRef.current = true
  const currentIdentity = identityKey
  const reqId = beginRequest(reqRef)
  if (abortRef.current) {
    abortRef.current.abort()
    abortRef.current = null
  }
  const ac = new AbortController()
  abortRef.current = ac
  setLoading(true)
  setError(null)
  cursorRef.current = 0
  let stopped = false
  let consecutiveFailures = 0

  const alive = () =>
    !stopped &&
    !ac.signal.aborted &&
    mountedRef.current &&
    shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef)

  async function pollLoop() {
    // NO_SESSION identity: completely idle.
    if (!sessionId || !cwd) {
      setLoading(false)
      return
    }

    try {
      const stateRes = await controller.getState()
      if (!alive()) return
      if (stateRes?.ok) {
        applyState(stateRes)
        consecutiveFailures = 0
      } else {
        consecutiveFailures += 1
      }
    } catch (err) {
      if (!alive()) return
      consecutiveFailures += 1
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (alive()) setLoading(false)
    }

    while (alive()) {
      if (consecutiveFailures >= DEBUG_WAIT_FAILURE_BUDGET) {
        setError('debug events wait failed repeatedly; subscription stopped — retry from Debug page')
        break
      }

      try {
        const waitRes = await controller.waitEvents(cursorRef.current, ac.signal)
        if (!alive()) break

        if (waitRes?.ok) {
          consecutiveFailures = 0
          setError(null)

          if (waitRes.identityRequired) {
            break
          }

          if (waitRes.woke) {
            const fresh = await controller.getState()
            if (alive() && fresh?.ok) applyState(fresh)
            continue
          }

          if (waitRes.closed) {
            applyState({ ok: true, session: null, pendingApprovals: [] })
            cursorRef.current = 0
            setEvents([])
            // Return to owner-session discovery for the next Agent/debug start.
            continue
          }

          if (waitRes.nextCursor != null) {
            cursorRef.current = waitRes.nextCursor
          }

          const incoming = Array.isArray(waitRes.events) ? waitRes.events : []
          if (incoming.length > 0) {
            setEvents((prev) => [...prev, ...incoming].slice(-100))

            const needStateRefresh = projectDebugEvents(incoming, {
              setStatus,
              setPendingControl,
              setActive,
            })

            if (needStateRefresh) {
              const fresh = await controller.getState()
              if (alive() && fresh?.ok) {
                applyState(fresh)
                refreshRegisters()
                evaluateWatches(watchesRef.current, 0)
              }
            }
          }
          // Empty timeout (no woke/closed/events): re-hang waitForOwnerSession / waitEvents.
          continue
        }

        consecutiveFailures += 1
        if (consecutiveFailures >= DEBUG_WAIT_FAILURE_BUDGET) {
          setError('debug events wait failed repeatedly; subscription stopped — retry from Debug page')
          break
        }
        await sleep(debugWaitBackoffMs(consecutiveFailures), ac.signal)
      } catch (err) {
        if (!alive() || ac.signal.aborted || (err && /** @type {any} */ (err).name === 'AbortError')) {
          break
        }
        consecutiveFailures += 1
        if (consecutiveFailures >= DEBUG_WAIT_FAILURE_BUDGET) {
          setError(err instanceof Error ? err.message : String(err))
          break
        }
        try {
          await sleep(debugWaitBackoffMs(consecutiveFailures), ac.signal)
        } catch {
          break
        }
      }
    }
  }

  pollLoop()

  return () => {
    stopped = true
    mountedRef.current = false
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }
}
