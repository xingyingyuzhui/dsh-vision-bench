export const DEFAULT_POINT_COL_WIDTHS = {
  name: 240,
  fn: 70,
  addr: 75,
  value: 100,
  monitor: 70,
  scale: 80,
  offset: 70,
  unit: 75,
  alarm: 70,
  min: 85,
  max: 85,
  ops: 70,
}

export const MIN_POINT_COL_WIDTHS = {
  name: 100,
  fn: 48,
  addr: 48,
  value: 60,
  monitor: 50,
  scale: 50,
  offset: 50,
  unit: 50,
  alarm: 50,
  min: 55,
  max: 55,
  ops: 50,
}

const STORAGE_KEY = 'dvb_point_col_widths'

export function getPointTableScopeKey(devOrKey, connId) {
  if (!devOrKey) return connId || 'default'
  if (typeof devOrKey === 'string') {
    if (connId && !devOrKey.includes(':')) return `${connId}:${devOrKey}`
    return devOrKey
  }
  const devId = devOrKey.id || devOrKey.deviceId || 'default'
  const cId = devOrKey.connectionId || devOrKey.connId || connId
  return cId ? `${cId}:${devId}` : String(devId)
}

export function sanitizePointColWidths(widths) {
  const result = { ...DEFAULT_POINT_COL_WIDTHS }
  if (!widths || typeof widths !== 'object') return result
  for (const k of Object.keys(DEFAULT_POINT_COL_WIDTHS)) {
    if (typeof widths[k] === 'number' && widths[k] > 0) {
      const min = MIN_POINT_COL_WIDTHS[k] || 45
      result[k] = Math.max(min, Math.min(800, Math.round(widths[k])))
    }
  }
  return result
}

export function loadAllPointColWidths() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.name === 'number' || typeof parsed.value === 'number') {
            return { default: sanitizePointColWidths(parsed) }
          }
          const map = {}
          for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v === 'object') {
              map[k] = sanitizePointColWidths(v)
            }
          }
          return map
        }
      }
    }
  } catch {}
  return {}
}

export function saveAllPointColWidths(map) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    }
  } catch {}
}

export function loadPointColWidths(scopeKey = 'default') {
  const all = loadAllPointColWidths()
  return all[scopeKey] ? { ...all[scopeKey] } : { ...DEFAULT_POINT_COL_WIDTHS }
}

export function savePointColWidths(widths, scopeKey = 'default') {
  const all = loadAllPointColWidths()
  all[scopeKey] = sanitizePointColWidths(widths)
  saveAllPointColWidths(all)
}

export function usePointColWidths(React) {
  const useCallback = typeof React.useCallback === 'function' ? React.useCallback : (fn) => fn
  const [colWidthsByDevice, setColWidthsByDevice] = React.useState(() => loadAllPointColWidths())
  const colWidthsByDeviceRef = React.useRef(colWidthsByDevice)
  colWidthsByDeviceRef.current = colWidthsByDevice

  const getColWidths = useCallback(
    (devOrKey, connId) => {
      const scopeKey = getPointTableScopeKey(devOrKey, connId)
      return colWidthsByDevice[scopeKey] || DEFAULT_POINT_COL_WIDTHS
    },
    [colWidthsByDevice],
  )

  const onStartResize = useCallback((colKey, e, devOrKey, connId) => {
    if (e.button != null && e.button !== 0) return

    e.preventDefault()
    e.stopPropagation()

    const scopeKey = getPointTableScopeKey(devOrKey, connId)
    const startX = e.clientX

    const currentDeviceWidths = colWidthsByDeviceRef.current[scopeKey] || DEFAULT_POINT_COL_WIDTHS
    const startWidth = currentDeviceWidths[colKey] || DEFAULT_POINT_COL_WIDTHS[colKey]
    const minWidth = MIN_POINT_COL_WIDTHS[colKey] || 45

    const resizerEl = e.currentTarget
    resizerEl?.classList?.add('is-resizing')

    if (typeof document !== 'undefined') {
      document.body?.classList?.add('dvb-resizing-col')
    }

    let latestWidth = startWidth

    const onPointerMove = (moveEvt) => {
      moveEvt.preventDefault()
      const delta = moveEvt.clientX - startX
      latestWidth = Math.max(minWidth, Math.round(startWidth + delta))
      setColWidthsByDevice((prev) => {
        const prevDev = prev[scopeKey] || DEFAULT_POINT_COL_WIDTHS
        if (prevDev[colKey] === latestWidth) return prev
        const nextDev = { ...prevDev, [colKey]: latestWidth }
        const nextAll = { ...prev, [scopeKey]: nextDev }
        colWidthsByDeviceRef.current = nextAll
        return nextAll
      })
    }

    const onPointerUp = (upEvt) => {
      upEvt?.preventDefault?.()
      resizerEl?.classList?.remove('is-resizing')
      if (typeof document !== 'undefined') {
        document.body?.classList?.remove('dvb-resizing-col')
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
        document.removeEventListener('pointercancel', onPointerUp)
        document.removeEventListener('mousemove', onPointerMove)
        document.removeEventListener('mouseup', onPointerUp)
      }
      setColWidthsByDevice((prev) => {
        const prevDev = prev[scopeKey] || DEFAULT_POINT_COL_WIDTHS
        const nextDev = { ...prevDev, [colKey]: latestWidth }
        const nextAll = { ...prev, [scopeKey]: nextDev }
        colWidthsByDeviceRef.current = nextAll
        saveAllPointColWidths(nextAll)
        return nextAll
      })
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerUp)
      document.addEventListener('mousemove', onPointerMove)
      document.addEventListener('mouseup', onPointerUp)
    }
  }, [])

  const resetColWidth = useCallback((colKey, devOrKey, connId) => {
    const scopeKey = getPointTableScopeKey(devOrKey, connId)
    setColWidthsByDevice((prev) => {
      const prevDev = prev[scopeKey] || DEFAULT_POINT_COL_WIDTHS
      const nextDev = { ...prevDev, [colKey]: DEFAULT_POINT_COL_WIDTHS[colKey] }
      const nextAll = { ...prev, [scopeKey]: nextDev }
      colWidthsByDeviceRef.current = nextAll
      saveAllPointColWidths(nextAll)
      return nextAll
    })
  }, [])

  const totalTableWidth = useCallback(
    (showOps, devOrKey, connId) => {
      const scopeKey = getPointTableScopeKey(devOrKey, connId)
      const widths = colWidthsByDevice[scopeKey] || DEFAULT_POINT_COL_WIDTHS
      const keys = ['name', 'fn', 'addr', 'value', 'monitor', 'scale', 'offset', 'unit', 'alarm', 'min', 'max']
      let total = 0
      for (const k of keys) {
        total += widths[k] || DEFAULT_POINT_COL_WIDTHS[k]
      }
      if (showOps) {
        total += widths.ops || DEFAULT_POINT_COL_WIDTHS.ops
      }
      return total
    },
    [colWidthsByDevice],
  )

  const defaultWidths = colWidthsByDevice.default || DEFAULT_POINT_COL_WIDTHS
  const colWidths = new Proxy(colWidthsByDevice, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in DEFAULT_POINT_COL_WIDTHS) {
        return defaultWidths[prop] ?? DEFAULT_POINT_COL_WIDTHS[prop]
      }
      return target[prop]
    },
  })

  const setColWidths = useCallback((valOrFn, scopeKey = 'default') => {
    setColWidthsByDevice((prev) => {
      const prevDev = prev[scopeKey] || DEFAULT_POINT_COL_WIDTHS
      const nextDev = typeof valOrFn === 'function' ? valOrFn(prevDev) : valOrFn
      const nextAll = { ...prev, [scopeKey]: nextDev }
      colWidthsByDeviceRef.current = nextAll
      saveAllPointColWidths(nextAll)
      return nextAll
    })
  }, [])

  return {
    colWidths,
    colWidthsByDevice,
    getColWidths,
    setColWidths,
    setColWidthsByDevice,
    onStartResize,
    resetColWidth,
    totalTableWidth,
  }
}
