import { getGridStack } from '../vendor/grid-runtime.mjs'

/** React owns the item DOM. GridStack only decorate/update existing items. */
export function createVizGrid(React) {
  const el = React.createElement
  const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
  return function VizGrid(props) {
    const hostRef = React.useRef(null)
    const gridRef = React.useRef(null)
    const onLayoutRef = React.useRef(props.onLayout)
    onLayoutRef.current = props.onLayout
    const ids = Array.isArray(props.itemIds) ? props.itemIds.join('\0') : ''

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
      const onChange = (_ev, items) => {
        if (typeof onLayoutRef.current !== 'function' || !items || !items.length) return
        onLayoutRef.current(
          items.map((n) => ({
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
      const live = new Set()
      for (const item of host.querySelectorAll(':scope > .grid-stack-item')) {
        live.add(item)
        if (!item.gridstackNode) grid.makeWidget(item)
      }
      for (const node of [...(grid.engine?.nodes ? grid.engine.nodes : [])]) {
        if (node.el && !live.has(node.el)) grid.removeWidget(node.el, false)
      }
    }, [ids])

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
