// @ts-check

import { beginRequest, shouldApplyRequest } from '../../common/latest-request-gate.mjs'
import { projectDebugEvents } from './debug-event-projection.mjs'

/**
 * Starts the ADR-014 cursor long-poll subscription for debug events.
 * Returns a cleanup function that aborts the poll and marks the effect stopped.
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

  async function pollLoop() {
    if (!sessionId || !cwd) {
      setLoading(false)
      return
    }
    try {
      const stateRes = await controller.getState()
      if (!shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) || stopped) {
        return
      }
      setLoading(false)
      if (stateRes?.ok) applyState(stateRes)
    } catch (err) {
      if (!shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) || stopped) {
        return
      }
      setLoading(false)
      setError(err instanceof Error ? err.message : String(err))
    }

    while (!stopped && !ac.signal.aborted && mountedRef.current) {
      try {
        const waitRes = await controller.waitEvents(cursorRef.current, ac.signal)
        if (!shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) || stopped) {
          break
        }
        if (waitRes?.ok) {
          if (waitRes.identityRequired) {
            break
          }
          if (waitRes.woke) {
            const fresh = await controller.getState()
            if (shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) && fresh?.ok) {
              applyState(fresh)
            }
            continue
          }
          if (waitRes.closed) {
            applyState({ ok: true, session: null, pendingApprovals: [] })
            cursorRef.current = 0
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
              if (shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) && fresh?.ok) {
                applyState(fresh)
                refreshRegisters()
                evaluateWatches(watchesRef.current, 0)
              }
            }
          }
        } else {
          await new Promise((r) => setTimeout(r, 1000))
        }
      } catch (err) {
        if (ac.signal.aborted || stopped || !mountedRef.current) {
          break
        }
        await new Promise((r) => setTimeout(r, 2000))
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
