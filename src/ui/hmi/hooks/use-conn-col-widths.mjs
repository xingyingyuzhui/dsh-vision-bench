export const DEFAULT_CONN_COL_WIDTHS = {
  name: 180,
  role: 110,
  endpoint: 260,
  actions: 260,
}

export const MIN_CONN_COL_WIDTHS = {
  name: 100,
  role: 70,
  endpoint: 140,
  actions: 220,
}

const STORAGE_KEY = 'dvb_conn_col_widths'

export function sanitizeConnColWidths(widths) {
  const result = { ...DEFAULT_CONN_COL_WIDTHS }
  if (!widths || typeof widths !== 'object') return result
  for (const k of Object.keys(DEFAULT_CONN_COL_WIDTHS)) {
    if (typeof widths[k] === 'number' && widths[k] > 0) {
      const min = MIN_CONN_COL_WIDTHS[k] || 50
      result[k] = Math.max(min, Math.min(1200, Math.round(widths[k])))
    }
  }
  return result
}

export function loadConnColWidths() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          return sanitizeConnColWidths(parsed)
        }
      }
    }
  } catch {}
  return { ...DEFAULT_CONN_COL_WIDTHS }
}

export function saveConnColWidths(widths) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeConnColWidths(widths)))
    }
  } catch {}
}

export function useConnColWidths(React) {
  const useCallback = typeof React.useCallback === 'function' ? React.useCallback : (fn) => fn
  const [connColWidths, setConnColWidths] = React.useState(() => loadConnColWidths())
  const connColWidthsRef = React.useRef(connColWidths)
  connColWidthsRef.current = connColWidths

  const onStartResize = useCallback((colKey, e) => {
    if (e.button != null && e.button !== 0) return

    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const currentWidths = connColWidthsRef.current || DEFAULT_CONN_COL_WIDTHS
    const startWidth = currentWidths[colKey] || DEFAULT_CONN_COL_WIDTHS[colKey]
    const minWidth = MIN_CONN_COL_WIDTHS[colKey] || 50

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
      setConnColWidths((prev) => {
        if (prev[colKey] === latestWidth) return prev
        const next = { ...prev, [colKey]: latestWidth }
        connColWidthsRef.current = next
        return next
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
      }
      setConnColWidths((prev) => {
        const next = { ...prev, [colKey]: latestWidth }
        connColWidthsRef.current = next
        saveConnColWidths(next)
        return next
      })
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerUp)
    }
  }, [])

  const resetColWidth = useCallback((colKey) => {
    setConnColWidths((prev) => {
      const next = { ...prev, [colKey]: DEFAULT_CONN_COL_WIDTHS[colKey] }
      connColWidthsRef.current = next
      saveConnColWidths(next)
      return next
    })
  }, [])

  const totalTableWidth = useCallback(() => {
    const widths = connColWidthsRef.current || DEFAULT_CONN_COL_WIDTHS
    let total = 0
    for (const k of Object.keys(DEFAULT_CONN_COL_WIDTHS)) {
      total += widths[k] || DEFAULT_CONN_COL_WIDTHS[k]
    }
    return total
  }, [])

  return {
    connColWidths,
    setConnColWidths,
    onStartConnResize: onStartResize,
    resetConnColWidth: resetColWidth,
    totalConnTableWidth: totalTableWidth,
  }
}
