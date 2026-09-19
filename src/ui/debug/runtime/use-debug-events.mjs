// @ts-check

import { createRuntimeController } from './runtime-controller.mjs'
import { normalizeDebugEventType } from './debug-event-projection.mjs'
import { startDebugEventSubscription } from './use-debug-event-subscription.mjs'
import { useDebugRuntimeActions } from './use-debug-runtime-actions.mjs'

export { normalizeDebugEventType }

/**
 * Hook for managing debug runtime events and state.
 * Implements ADR-014 cursor long-poll loop and request-gate lifecycle.
 * Composes subscription, projection, and control actions — does not own
 * persistence or host-side session state.
 *
 * @param {any} React
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 * @param {{ cwd?: string, sessionId?: string }} scope
 */
export function useDebugEvents(React, post, scope) {
  const cwd = scope?.cwd || ''
  const sessionId = scope?.sessionId || ''
  const identityKey = `${sessionId}:${cwd}`

  const [active, setActive] = React.useState(false)
  const [session, setSession] = React.useState(null)
  const [status, setStatus] = React.useState('idle')
  const [pendingControl, setPendingControl] = React.useState(null)
  const [pendingApprovals, setPendingApprovals] = React.useState([])
  const [events, setEvents] = React.useState([])
  const [selectedFrame, setSelectedFrame] = React.useState(0)
  const [variables, setVariables] = React.useState({ locals: [], registers: [] })
  const [watches, setWatches] = React.useState([])
  const [watchValues, setWatchValues] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  const reqRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const abortRef = React.useRef(null)
  const cursorRef = React.useRef(0)
  const frameSeqRef = React.useRef(0)
  const watchSeqRef = React.useRef(0)
  const watchesRef = React.useRef(watches)
  watchesRef.current = watches

  const controller = React.useMemo(() => {
    return createRuntimeController(post, { cwd, sessionId })
  }, [post, cwd, sessionId])

  const applyState = React.useCallback((data) => {
    if (!data || typeof data !== 'object') return
    const curSession = data.session || null
    setSession(curSession)
    setActive(Boolean(curSession))
    if (Array.isArray(data.pendingApprovals)) {
      setPendingApprovals(data.pendingApprovals)
    }
    if (curSession) {
      if (curSession.state) setStatus(curSession.state)
      if (Array.isArray(curSession.variables)) {
        setVariables((prev) => ({ ...prev, locals: curSession.variables }))
      }
      if (curSession.eventCursor != null && curSession.eventCursor > cursorRef.current) {
        cursorRef.current = curSession.eventCursor
      }
    } else {
      setStatus('idle')
    }
  }, [])

  const evaluateWatches = React.useCallback(
    async (watchList, frame = 0) => {
      const seq = ++watchSeqRef.current
      if (!Array.isArray(watchList) || watchList.length === 0) {
        setWatchValues([])
        return
      }
      const results = []
      for (const expr of watchList) {
        if (seq !== watchSeqRef.current || !mountedRef.current) return
        try {
          const res = await controller.command('evaluate', { expression: expr, frameLevel: frame })
          if (res?.ok) {
            results.push({ expression: expr, value: res.result || res.value || 'void', error: null })
          } else {
            results.push({ expression: expr, value: null, error: res?.error || '无法求值' })
          }
        } catch (err) {
          results.push({ expression: expr, value: null, error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (seq === watchSeqRef.current && mountedRef.current) {
        setWatchValues(results)
      }
    },
    [controller],
  )

  const refreshRegisters = React.useCallback(async () => {
    try {
      const res = await controller.command('registers')
      if (res?.ok && Array.isArray(res.registers)) {
        setVariables((prev) => ({ ...prev, registers: res.registers }))
      }
    } catch {
      // Non-critical, ignore
    }
  }, [controller])

  const selectFrame = React.useCallback(
    async (frameLevel) => {
      setSelectedFrame(frameLevel)
      const seq = ++frameSeqRef.current
      try {
        const res = await controller.command('locals', { frameLevel })
        if (seq !== frameSeqRef.current || !mountedRef.current) return
        if (res?.ok && Array.isArray(res.variables)) {
          setVariables((prev) => ({ ...prev, locals: res.variables }))
        }
        if (seq !== frameSeqRef.current || !mountedRef.current) return
        await evaluateWatches(watchesRef.current, frameLevel)
      } catch (err) {
        if (seq !== frameSeqRef.current || !mountedRef.current) return
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [controller, evaluateWatches],
  )

  React.useEffect(() => {
    return startDebugEventSubscription({
      React,
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
    })
    // Remount only on identity/controller change. Session discovery uses server-side
    // waitForOwnerSession; do not remount when `active` flips or we abort the hang.
  }, [identityKey, controller, applyState, refreshRegisters, evaluateWatches, sessionId, cwd])

  const controlActions = useDebugRuntimeActions(React, {
    controller,
    applyState,
    evaluateWatches,
    refreshRegisters,
    watchesRef,
    selectedFrame,
    setError,
    setPendingControl,
    setStatus,
    setWatches,
    setLoading,
  })

  return {
    active,
    session,
    status,
    pendingControl,
    pendingApprovals,
    events,
    selectedFrame,
    variables,
    watches,
    watchValues,
    loading,
    error,
    actions: {
      ...controlActions,
      selectFrame,
    },
  }
}
