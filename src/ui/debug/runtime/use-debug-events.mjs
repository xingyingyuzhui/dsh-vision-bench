// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../shared/debug-events.mjs'
import { beginRequest, shouldApplyRequest } from '../../common/latest-request-gate.mjs'
import { createRuntimeController } from './runtime-controller.mjs'

/**
 * Normalizes legacy event alias strings to canonical DEBUG_EVENT_TYPES.
 * @param {string} [type]
 * @returns {string}
 */
export function normalizeDebugEventType(type) {
  const t = String(type || '')
  if (t === 'running') return DEBUG_EVENT_TYPES.RUNNING
  if (t === 'paused') return DEBUG_EVENT_TYPES.PAUSED
  if (t === 'step_complete') return DEBUG_EVENT_TYPES.STEP_COMPLETE
  if (t === 'breakpoint_hit') return DEBUG_EVENT_TYPES.BREAKPOINT_HIT
  if (t === 'watchpoint_hit') return DEBUG_EVENT_TYPES.WATCHPOINT_HIT
  if (t === 'session_stopped') return DEBUG_EVENT_TYPES.SESSION_STOPPED
  return t
}

/**
 * Hook for managing debug runtime events and state.
 * Implements ADR-014 cursor long-poll loop and request-gate lifecycle.
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

  const controller = React.useMemo(() => {
    return createRuntimeController(post, { cwd, sessionId })
  }, [post, cwd, sessionId])

  // Helper to safely update session data
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

  // Evaluate watches on demand
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

  // Fetch registers
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

  // Select stack frame
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
        await evaluateWatches(watches, frameLevel)
      } catch (err) {
        if (seq !== frameSeqRef.current || !mountedRef.current) return
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [controller, watches, evaluateWatches],
  )

  // Main polling loop
  React.useEffect(() => {
    mountedRef.current = true
    const currentIdentity = identityKey
    const reqId = beginRequest(reqRef)

    // Abort previous polling if any
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    const ac = new AbortController()
    abortRef.current = ac

    // Initial state fetch
    setLoading(true)
    setError(null)
    cursorRef.current = 0

    let stopped = false

    async function pollLoop() {
      try {
        const stateRes = await controller.getState()
        if (!shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) || stopped) {
          return
        }
        setLoading(false)
        if (stateRes?.ok) {
          applyState(stateRes)
        }
      } catch (err) {
        if (!shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) || stopped) {
          return
        }
        setLoading(false)
        setError(err instanceof Error ? err.message : String(err))
      }

      // Event wait loop
      while (!stopped && !ac.signal.aborted && mountedRef.current) {
        try {
          const waitRes = await controller.waitEvents(cursorRef.current, ac.signal)
          if (!shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) || stopped) {
            break
          }
          if (waitRes?.ok) {
            if (waitRes.closed) {
              // No active debug session or session closed; idle poll at 1000ms
              await new Promise((r) => setTimeout(r, 1000))
            }
            if (waitRes.nextCursor != null) {
              cursorRef.current = waitRes.nextCursor
            }
            const incoming = Array.isArray(waitRes.events) ? waitRes.events : []
            if (incoming.length > 0) {
              setEvents((prev) => [...prev, ...incoming].slice(-100))

              // Check if any stop or pause events arrived
              let needStateRefresh = false
              for (const ev of incoming) {
                const type = normalizeDebugEventType(ev.type)
                if (type === DEBUG_EVENT_TYPES.RUNNING) {
                  setStatus('running')
                  setPendingControl(null)
                } else if (
                  type === DEBUG_EVENT_TYPES.PAUSED ||
                  type === DEBUG_EVENT_TYPES.STEP_COMPLETE ||
                  type === DEBUG_EVENT_TYPES.BREAKPOINT_HIT ||
                  type === DEBUG_EVENT_TYPES.WATCHPOINT_HIT
                ) {
                  setStatus('paused')
                  setPendingControl(null)
                  needStateRefresh = true
                } else if (type === DEBUG_EVENT_TYPES.EXCEPTION) {
                  setStatus('failed')
                  setPendingControl(null)
                  needStateRefresh = true
                } else if (type === DEBUG_EVENT_TYPES.SESSION_STOPPED) {
                  setStatus('stopped')
                  setActive(false)
                  setPendingControl(null)
                  needStateRefresh = true
                } else if (type.includes('breakpoint') || type.includes('watchpoint') || type.includes('snapshot')) {
                  needStateRefresh = true
                }
              }

              if (needStateRefresh) {
                const fresh = await controller.getState()
                if (shouldApplyRequest(reqRef, reqId, currentIdentity, identityKey, mountedRef) && fresh?.ok) {
                  applyState(fresh)
                  refreshRegisters()
                  evaluateWatches(watches, 0)
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
          // Sleep briefly on network error before retrying poll
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
  }, [identityKey, controller, applyState, refreshRegisters, evaluateWatches, watches])

  // Controller Actions
  const startDebug = React.useCallback(
    async (options = {}) => {
      setError(null)
      setPendingControl('starting')
      try {
        const res = await controller.command('start', options)
        if (!res?.ok) {
          setPendingControl(null)
          setError(res?.error || '启动调试失败')
        } else {
          const fresh = await controller.getState()
          if (fresh?.ok) applyState(fresh)
          setPendingControl(null)
        }
        return res
      } catch (err) {
        setPendingControl(null)
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const stopDebug = React.useCallback(async () => {
    setPendingControl('stopping')
    try {
      const res = await controller.command('stop')
      const fresh = await controller.getState()
      if (fresh?.ok) applyState(fresh)
      setPendingControl(null)
      return res
    } catch (err) {
      setPendingControl(null)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return { ok: false, error: msg }
    }
  }, [controller, applyState])

  const run = React.useCallback(async () => {
    setPendingControl(null)
    try {
      const res = await controller.command('continue')
      if (res?.ok) setStatus('running')
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return { ok: false, error: msg }
    }
  }, [controller])

  const pause = React.useCallback(async () => {
    setPendingControl('pausing')
    try {
      const res = await controller.command('pause')
      if (!res?.ok) {
        setPendingControl(null)
        setError(res?.error || '暂停失败')
      }
      return res
    } catch (err) {
      setPendingControl(null)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return { ok: false, error: msg }
    }
  }, [controller])

  const step = React.useCallback(
    async (stepType = 'over') => {
      setPendingControl('stepping')
      try {
        const res = await controller.command('step', { stepType })
        if (!res?.ok) {
          setPendingControl(null)
          setError(res?.error || '单步失败')
        }
        return res
      } catch (err) {
        setPendingControl(null)
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller],
  )

  const reset = React.useCallback(async () => {
    setPendingControl('resetting')
    try {
      const res = await controller.command('resetHalt')
      if (!res?.ok) {
        setPendingControl(null)
        setError(res?.error || '复位失败')
      }
      return res
    } catch (err) {
      setPendingControl(null)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return { ok: false, error: msg }
    }
  }, [controller])

  const addBreakpoint = React.useCallback(
    async (spec) => {
      try {
        const res = await controller.command('addBreakpoint', spec)
        if (res?.ok) {
          const fresh = await controller.getState()
          if (fresh?.ok) applyState(fresh)
        } else {
          setError(res?.error || '添加断点失败')
        }
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const removeBreakpoint = React.useCallback(
    async (id) => {
      try {
        const res = await controller.command('removeBreakpoint', { id })
        if (res?.ok) {
          const fresh = await controller.getState()
          if (fresh?.ok) applyState(fresh)
        }
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const addWatchpoint = React.useCallback(
    async (spec) => {
      try {
        const res = await controller.command('addWatchpoint', spec)
        if (res?.ok) {
          const fresh = await controller.getState()
          if (fresh?.ok) applyState(fresh)
        } else {
          setError(res?.error || '添加观察点失败')
        }
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const removeWatchpoint = React.useCallback(
    async (id) => {
      try {
        const res = await controller.command('removeWatchpoint', { id })
        if (res?.ok) {
          const fresh = await controller.getState()
          if (fresh?.ok) applyState(fresh)
        }
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const addWatch = React.useCallback(
    (expr) => {
      const trimmed = String(expr || '').trim()
      if (!trimmed || watches.includes(trimmed)) return
      const next = [...watches, trimmed]
      setWatches(next)
      evaluateWatches(next, selectedFrame)
    },
    [watches, selectedFrame, evaluateWatches],
  )

  const removeWatch = React.useCallback(
    (expr) => {
      const next = watches.filter((w) => w !== expr)
      setWatches(next)
      evaluateWatches(next, selectedFrame)
    },
    [watches, selectedFrame, evaluateWatches],
  )

  const approve = React.useCallback(
    async (requestId) => {
      try {
        const res = await controller.approval('approve', { requestId })
        const fresh = await controller.getState()
        if (fresh?.ok) applyState(fresh)
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const reject = React.useCallback(
    async (requestId) => {
      try {
        const res = await controller.approval('reject', { requestId })
        const fresh = await controller.getState()
        if (fresh?.ok) applyState(fresh)
        return res
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { ok: false, error: msg }
      }
    },
    [controller, applyState],
  )

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fresh = await controller.getState()
      if (fresh?.ok) {
        applyState(fresh)
        refreshRegisters()
        evaluateWatches(watches, selectedFrame)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [controller, applyState, refreshRegisters, evaluateWatches, watches, selectedFrame])

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
      startDebug,
      stopDebug,
      run,
      pause,
      step,
      reset,
      addBreakpoint,
      removeBreakpoint,
      addWatchpoint,
      removeWatchpoint,
      selectFrame,
      addWatch,
      removeWatch,
      approve,
      reject,
      refresh,
    },
  }
}
