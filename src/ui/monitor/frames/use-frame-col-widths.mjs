export const DEFAULT_FRAME_COL_WIDTHS = {
  time: 76,
  port: 72,
  dir: 88,
  device: 88,
  fc: 64,
  status: 64,
  bytes: 64,
  hex: 220,
}

export const MIN_FRAME_COL_WIDTHS = {
  time: 55,
  port: 50,
  dir: 60,
  device: 60,
  fc: 48,
  status: 48,
  bytes: 48,
  hex: 100,
}

const STORAGE_KEY = 'dvb_frame_col_widths'

export function sanitizeFrameColWidths(widths) {
  const result = { ...DEFAULT_FRAME_COL_WIDTHS }
  if (!widths || typeof widths !== 'object') return result
  for (const k of Object.keys(DEFAULT_FRAME_COL_WIDTHS)) {
    if (typeof widths[k] === 'number' && widths[k] > 0) {
      const min = MIN_FRAME_COL_WIDTHS[k] || 45
      result[k] = Math.max(min, Math.min(1200, Math.round(widths[k])))
    }
  }
  return result
}

export function loadFrameColWidths() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          const sanitized = sanitizeFrameColWidths(parsed)
          if (sanitized.time === 118) sanitized.time = DEFAULT_FRAME_COL_WIDTHS.time
          return sanitized
        }
      }
    }
  } catch {}
  return { ...DEFAULT_FRAME_COL_WIDTHS }
}

export function saveFrameColWidths(widths) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    }
  } catch {}
}

export function useFrameColWidths(React) {
  const useCallback = typeof React.useCallback === 'function' ? React.useCallback : (fn) => fn
  const [colWidths, setColWidths] = React.useState(() => loadFrameColWidths())
  const colWidthsRef = React.useRef(colWidths)
  colWidthsRef.current = colWidths

  const onStartResize = useCallback(
    (colKey, e) => {
      if (e.button != null && e.button !== 0) return

      e.preventDefault()
      e.stopPropagation()

      const startX = e.clientX
      const resizerEl = e.currentTarget
      const thEl = resizerEl?.closest ? resizerEl.closest('.dvb-data-th') : null
      const currentDeviceWidths = colWidthsRef.current || DEFAULT_FRAME_COL_WIDTHS
      const startWidth = thEl?.getBoundingClientRect
        ? Math.round(thEl.getBoundingClientRect().width)
        : currentDeviceWidths[colKey] || DEFAULT_FRAME_COL_WIDTHS[colKey] || 80
      const minWidth = MIN_FRAME_COL_WIDTHS[colKey] || 45

      resizerEl?.classList?.add('is-resizing')

      if (typeof document !== 'undefined') {
        document.body?.classList?.add('dvb-resizing-col')
      }

      let latestWidth = startWidth

      const onPointerMove = (moveEvt) => {
        moveEvt.preventDefault()
        const delta = moveEvt.clientX - startX
        latestWidth = Math.max(minWidth, Math.round(startWidth + delta))
        setColWidths((prev) => {
          if (prev[colKey] === latestWidth) return prev
          const next = { ...prev, [colKey]: latestWidth }
          colWidthsRef.current = next
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
          document.removeEventListener('mousemove', onPointerMove)
          document.removeEventListener('mouseup', onPointerUp)
        }
        setColWidths((prev) => {
          const next = { ...prev, [colKey]: latestWidth }
          colWidthsRef.current = next
          saveFrameColWidths(next)
          return next
        })
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('pointermove', onPointerMove)
        document.addEventListener('pointerup', onPointerUp)
        document.addEventListener('pointercancel', onPointerUp)
        document.addEventListener('mousemove', onPointerMove)
        document.addEventListener('mouseup', onPointerUp)
      }
    },
    [useCallback],
  )

  const resetColWidth = useCallback(
    (colKey) => {
      setColWidths((prev) => {
        const next = { ...prev, [colKey]: DEFAULT_FRAME_COL_WIDTHS[colKey] }
        colWidthsRef.current = next
        saveFrameColWidths(next)
        return next
      })
    },
    [useCallback],
  )

  const totalTableWidth = useCallback(
    (mode = 'proto') => {
      const widths = colWidthsRef.current || DEFAULT_FRAME_COL_WIDTHS
      const keys =
        mode === 'raw'
          ? ['time', 'port', 'dir', 'bytes', 'hex']
          : ['time', 'port', 'dir', 'device', 'fc', 'status', 'hex']
      let total = 0
      for (const k of keys) {
        total += widths[k] || DEFAULT_FRAME_COL_WIDTHS[k] || 64
      }
      return total + (keys.length - 1) * 8 + 16
    },
    [useCallback],
  )

  return {
    colWidths,
    setColWidths,
    onStartResize,
    resetColWidth,
    totalTableWidth,
  }
}
