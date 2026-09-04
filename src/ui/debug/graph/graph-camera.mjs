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
export function fitViewTransform(layout, viewportW, viewportH, padding = 24) {
  const w = Number(layout?.width) || 320
  const h = Number(layout?.height) || 240
  const vw = Math.max(120, Number(viewportW) || 320)
  const vh = Math.max(120, Number(viewportH) || 240)
  const scale = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 1.4)
  const panX = (vw - w * scale) / 2
  const panY = (vh - h * scale) / 2
  return { scale, panX, panY }
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

/**
 * Creates React hook for graph camera pan, zoom, fit and resize observer.
 * @param {any} React
 */
export function createUseGraphCamera(React) {
  return function useGraphCamera({ layout, selectedId, hostRef, minScale = 0.35, maxScale = 2.5 }) {
    const [pan, setPan] = React.useState({ x: 0, y: 0 })
    const [scale, setScale] = React.useState(1)
    const dragRef = React.useRef(null)

    const fit = React.useCallback(() => {
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const next = fitViewTransform(layout, rect.width, rect.height)
      setPan({ x: next.panX, y: next.panY })
      setScale(next.scale)
    }, [layout, hostRef])

    React.useEffect(() => {
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      if (selectedId) {
        const next = focusNodeTransform(layout, selectedId, rect.width, rect.height)
        setPan({ x: next.panX, y: next.panY })
        setScale(next.scale)
        return
      }
      fit()
    }, [fit, layout, selectedId, hostRef])

    React.useEffect(() => {
      const host = hostRef.current
      if (!host || typeof ResizeObserver === 'undefined') return undefined
      const ro = new ResizeObserver(() => {
        if (selectedId) {
          const rect = host.getBoundingClientRect()
          const next = focusNodeTransform(layout, selectedId, rect.width, rect.height)
          setPan({ x: next.panX, y: next.panY })
          setScale(next.scale)
        } else {
          fit()
        }
      })
      ro.observe(host)
      return () => ro.disconnect()
    }, [fit, layout, selectedId, hostRef])

    const onWheel = (ev) => {
      ev.preventDefault()
      const delta = ev.deltaY > 0 ? 0.92 : 1.08
      setScale((s) => clamp(s * delta, minScale, maxScale))
    }

    const onPointerDown = (ev) => {
      if (ev.button !== 0) return
      dragRef.current = { x: ev.clientX, y: ev.clientY, panX: pan.x, panY: pan.y }
      ev.currentTarget.setPointerCapture(ev.pointerId)
    }

    const onPointerMove = (ev) => {
      const drag = dragRef.current
      if (!drag) return
      setPan({
        x: drag.panX + (ev.clientX - drag.x),
        y: drag.panY + (ev.clientY - drag.y),
      })
    }

    const onPointerUp = (ev) => {
      dragRef.current = null
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId)
      } catch {}
    }

    return {
      pan,
      setPan,
      scale,
      setScale,
      fit,
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    }
  }
}
