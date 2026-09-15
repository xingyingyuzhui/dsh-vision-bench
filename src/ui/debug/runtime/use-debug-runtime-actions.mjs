// @ts-check

/**
 * Control / breakpoint / watch / approval actions for the debug runtime hook.
 * Pure action factories — no subscription or event projection.
 *
 * @param {any} React
 * @param {{
 *   controller: ReturnType<typeof import('./runtime-controller.mjs').createRuntimeController>,
 *   applyState: (data: any) => void,
 *   evaluateWatches: (watchList: string[], frame?: number) => Promise<void>,
 *   refreshRegisters: () => Promise<void>,
 *   watchesRef: { current: string[] },
 *   selectedFrame: number,
 *   setError: (v: any) => void,
 *   setPendingControl: (v: any) => void,
 *   setStatus: (s: string) => void,
 *   setWatches: (v: string[]) => void,
 *   setLoading: (v: boolean) => void,
 * }} ctx
 */
export function useDebugRuntimeActions(React, ctx) {
  const {
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
  } = ctx

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
    [controller, applyState, setError, setPendingControl],
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
  }, [controller, applyState, setError, setPendingControl])

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
  }, [controller, setPendingControl, setStatus, setError])

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
  }, [controller, setPendingControl, setError])

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
    [controller, setPendingControl, setError],
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
  }, [controller, setPendingControl, setError])

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
    [controller, applyState, setError],
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
    [controller, applyState, setError],
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
    [controller, applyState, setError],
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
    [controller, applyState, setError],
  )

  const addWatch = React.useCallback(
    (expr) => {
      const trimmed = String(expr || '').trim()
      if (!trimmed || watchesRef.current.includes(trimmed)) return
      const next = [...watchesRef.current, trimmed]
      watchesRef.current = next
      setWatches(next)
      evaluateWatches(next, selectedFrame)
    },
    [watchesRef, selectedFrame, evaluateWatches, setWatches],
  )

  const removeWatch = React.useCallback(
    (expr) => {
      const next = watchesRef.current.filter((w) => w !== expr)
      watchesRef.current = next
      setWatches(next)
      evaluateWatches(next, selectedFrame)
    },
    [watchesRef, selectedFrame, evaluateWatches, setWatches],
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
    [controller, applyState, setError],
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
    [controller, applyState, setError],
  )

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fresh = await controller.getState()
      if (fresh?.ok) {
        applyState(fresh)
        refreshRegisters()
        evaluateWatches(watchesRef.current, selectedFrame)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [controller, applyState, refreshRegisters, evaluateWatches, selectedFrame, watchesRef, setLoading, setError])

  return {
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
    addWatch,
    removeWatch,
    approve,
    reject,
    refresh,
  }
}
