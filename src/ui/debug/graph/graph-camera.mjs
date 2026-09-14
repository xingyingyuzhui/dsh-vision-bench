// @ts-check

/**
 * Clamp a number within range [min, max].
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

/**
 * Calculates pan and scale to fit graph layout within the viewport.
 * @param {{ width?: number, height?: number } | null | undefined} layout
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} [padding]
 * @returns {{ scale: number, panX: number, panY: number }}
 */
export function isUsableViewport(viewportW, viewportH) {
  return Number(viewportW) > 80 && Number(viewportH) > 80
}

export function fitViewTransform(layout, viewportW, viewportH, padding = 24) {
  const w = Number(layout?.width) || 320
  const h = Number(layout?.height) || 240
  const vw = Number(viewportW)
  const vh = Number(viewportH)
  if (!isUsableViewport(vw, vh)) return { scale: 1, panX: 24, panY: 24 }
  const raw = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 1.4)
  const scale = clamp(raw, 0.35, 1.4)
  const panX = (vw - w * scale) / 2
  const panY = (vh - h * scale) / 2
  return { scale, panX, panY }
}

/**
 * Zoom around a viewport point so the graph point under the cursor/center stays put.
 * @param {{ panX: number, panY: number, scale: number }} camera
 * @param {number} factor
 * @param {number} originX
 * @param {number} originY
 * @param {number} [minScale]
 * @param {number} [maxScale]
 */
export function zoomAround(camera, factor, originX, originY, minScale = 0.35, maxScale = 2.5) {
  const scale = Number(camera?.scale) || 1
  const panX = Number(camera?.panX) || 0
  const panY = Number(camera?.panY) || 0
  const next = clamp(scale * Number(factor || 1), minScale, maxScale)
  if (next === scale) return { scale, panX, panY }
  const gx = (Number(originX) - panX) / scale
  const gy = (Number(originY) - panY) / scale
  return { scale: next, panX: Number(originX) - gx * next, panY: Number(originY) - gy * next }
}

/**
 * Calculates pan and scale to center viewport on a specific node.
 * @param {{ nodes?: Array<{ id: string, x: number, y: number, w: number, h: number }>, width?: number, height?: number } | null | undefined} layout
 * @param {string} nodeId
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} [scale]
 * @param {number} [padding]
 * @returns {{ scale: number, panX: number, panY: number }}
 */
export function focusNodeTransform(layout, nodeId, viewportW, viewportH, scale = 1.15, padding = 32) {
  const node = (layout?.nodes || []).find((n) => n.id === nodeId)
  if (!node) return fitViewTransform(layout, viewportW, viewportH, padding)
  const vw = Math.max(120, Number(viewportW) || 320)
  const vh = Math.max(120, Number(viewportH) || 240)
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const clamped = Math.min(Math.max(scale, 0.5), 2.2)
  return {
    scale: clamped,
    panX: vw / 2 - cx * clamped,
    panY: vh / 2 - cy * clamped,
  }
}

const DEFAULT_PAN = { panX: 24, panY: 24, scale: 1 }
const ZOOM_STEP = 1.15

/**
 * Shared graph camera: fit on first usable size, zoom around cursor/center,
 * do not steal the view when a node is selected or the host resizes.
 * @param {any} React
 */
export function createUseGraphCamera(React) {
  return function useGraphCamera({
    layout,
    hostRef,
    minScale = 0.35,
    maxScale = 2.5,
    zoomStep = ZOOM_STEP,
    skipNodeDrag = true,
  }) {
    const [camera, setCamera] = React.useState(() => ({ ...DEFAULT_PAN }))
    const dragRef = React.useRef(null)
    const userCameraRef = React.useRef(false)

    const applyFit = React.useCallback(() => {
      const host = hostRef.current
      if (!host) return false
      const rect = host.getBoundingClientRect()
      if (!isUsableViewport(rect.width, rect.height)) return false
      userCameraRef.current = false
      setCamera(fitViewTransform(layout, rect.width, rect.height))
      return true
    }, [hostRef, layout])

    const zoomAt = React.useCallback(
      (factor, originX, originY) => {
        userCameraRef.current = true
        setCamera((prev) => zoomAround(prev, factor, originX, originY, minScale, maxScale))
      },
      [maxScale, minScale],
    )

    const zoomBy = React.useCallback(
      (factor) => {
        const host = hostRef.current
        const rect = host?.getBoundingClientRect()
        zoomAt(factor, rect ? rect.width / 2 : 0, rect ? rect.height / 2 : 0)
      },
      [hostRef, zoomAt],
    )

    React.useEffect(() => {
      applyFit()
    }, [applyFit])

    React.useEffect(() => {
      const host = hostRef.current
      if (!host || typeof ResizeObserver === 'undefined') return undefined
      const ro = new ResizeObserver(() => {
        if (userCameraRef.current) return
        applyFit()
      })
      ro.observe(host)
      return () => ro.disconnect()
    }, [applyFit, hostRef])

    React.useEffect(() => {
      const host = hostRef.current
      if (!host) return undefined
      const onW = (ev) => {
        ev.preventDefault()
        const rect = host.getBoundingClientRect()
        zoomAt(ev.deltaY > 0 ? 1 / zoomStep : zoomStep, ev.clientX - rect.left, ev.clientY - rect.top)
      }
      host.addEventListener('wheel', onW, { passive: false })
      return () => host.removeEventListener('wheel', onW)
    }, [hostRef, zoomAt, zoomStep])

    const onPointerDown = (ev) => {
      if (ev.button !== 0) return
      if (skipNodeDrag && typeof ev.target?.closest === 'function' && ev.target.closest('.dvb-graph-node')) return
      dragRef.current = {
        x: ev.clientX,
        y: ev.clientY,
        panX: camera.panX,
        panY: camera.panY,
        scale: camera.scale,
      }
      ev.currentTarget.setPointerCapture(ev.pointerId)
    }

    const onPointerMove = (ev) => {
      const drag = dragRef.current
      if (!drag) return
      userCameraRef.current = true
      setCamera({
        scale: drag.scale,
        panX: drag.panX + (ev.clientX - drag.x),
        panY: drag.panY + (ev.clientY - drag.y),
      })
    }

    const onPointerUp = (ev) => {
      dragRef.current = null
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
    }

    return {
      camera,
      pan: { x: camera.panX, y: camera.panY },
      scale: camera.scale,
      applyFit,
      fit: applyFit,
      zoomBy,
      zoomAt,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    }
  }
}
