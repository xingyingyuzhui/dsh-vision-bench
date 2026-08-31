import { getGridStack } from '../vendor/grid-runtime.mjs'

export function layoutSignature(items) {
  const list = Array.isArray(items) ? items : []
  return list
    .map((n) => `${String(n.id || '')}:${Number(n.x) || 0}:${Number(n.y) || 0}:${Number(n.w) || 0}:${Number(n.h) || 0}`)
    .sort()
    .join('|')
}

/** React owns the item DOM. GridStack only decorate/update existing items. */
export function createVizGrid(React) {
  const el = React.createElement
  const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
  return function VizGrid(props) {
    const hostRef = React.useRef(null)
    const gridRef = React.useRef(null)
    const onLayoutRef = React.useRef(props.onLayout)
    onLayoutRef.current = props.onLayout
    const syncingRef = React.useRef(false)
    const items = Array.isArray(props.items) ? props.items : []
    const signature = layoutSignature(items)

    useLayout(() => {
      const GridStack = getGridStack()
      const host = hostRef.current
      if (!GridStack || !host) return undefined
      const grid = GridStack.init(
        {
          column: Number(props.columns) > 0 ? Number(props.columns) : 12,
          cellHeight: 72,
          margin: 8,
          float: false,
          animate: false,
          handle: '.dvb-viz-drag',
          disableOneColumnMode: false,
        },
        host,
      )
      gridRef.current = grid
      const onChange = (_ev, changed) => {
        if (syncingRef.current) return
        if (typeof onLayoutRef.current !== 'function' || !changed || !changed.length) return
        onLayoutRef.current(
          changed.map((n) => ({
            id: String(n.id || n.el?.getAttribute('gs-id') || ''),
            x: n.x,
            y: n.y,
            w: n.w,
            h: n.h,
          })),
        )
      }
      grid.on('change', onChange)
      return () => {
        try {
          grid.off('change')
        } catch {}
        try {
          grid.destroy(false)
        } catch {}
        gridRef.current = null
      }
    }, [props.columns])

    useLayout(() => {
      const grid = gridRef.current
      const host = hostRef.current
      if (!grid || !host) return
      const wanted = new Map(items.map((item) => [String(item.id), item]))
      const live = new Map()
      for (const node of host.querySelectorAll(':scope > .grid-stack-item')) {
        live.set(String(node.getAttribute('gs-id') || ''), node)
      }
      syncingRef.current = true
      try {
        if (typeof grid.batchUpdate === 'function') grid.batchUpdate()
        for (const [id, spec] of wanted) {
          const node = live.get(id)
          if (!node) continue
          if (!node.gridstackNode) grid.makeWidget(node)
          grid.update(node, { x: spec.x, y: spec.y, w: spec.w, h: spec.h })
        }
        for (const node of [...(grid.engine?.nodes || [])]) {
          const id = String(node.id || node.el?.getAttribute('gs-id') || '')
          if (!wanted.has(id) && node.el) grid.removeWidget(node.el, false)
        }
        if (typeof grid.commit === 'function') grid.commit()
      } finally {
        syncingRef.current = false
      }
    }, [signature])

    const GridStack = getGridStack()
    return el(
      'div',
      {
        className: GridStack ? 'grid-stack dvb-viz-grid' : 'dvb-viz-grid dvb-viz-grid-fallback',
        ref: hostRef,
      },
      props.children,
    )
  }
}
