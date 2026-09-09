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
    const readOnlyRef = React.useRef(props.readOnly === true)
    readOnlyRef.current = props.readOnly === true
    const isEditable =
      props.editing !== undefined ? props.editing === true && props.readOnly !== true : props.readOnly !== true
    const isEditableRef = React.useRef(isEditable)
    isEditableRef.current = isEditable
    const items = Array.isArray(props.items) ? props.items : []
    const signature = layoutSignature(items)
    const maxRow = items.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 4)), 0)
    const editMinRow = isEditable ? Math.max(maxRow + 8, 16) : 0

    useLayout(() => {
      const GridStack = getGridStack()
      const host = hostRef.current
      if (!GridStack || !host) return undefined
      const grid = GridStack.init(
        {
          column: Number(props.columns) > 0 ? Number(props.columns) : 12,
          cellHeight: 72,
          margin: 8,
          float: true,
          minRow: editMinRow,
          animate: false,
          handle: '.dvb-viz-head-main, .dvb-viz-drag',
          disableOneColumnMode: false,
          staticGrid: !isEditable,
          disableDrag: !isEditable,
          disableResize: !isEditable,
        },
        host,
      )
      gridRef.current = grid
      const onChange = (_ev, changed) => {
        if (readOnlyRef.current || !isEditableRef.current) return
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
    }, [props.columns, props.readOnly])

    useLayout(() => {
      const grid = gridRef.current
      if (!grid) return
      if (typeof grid.setStatic === 'function') grid.setStatic(!isEditable)
      if (typeof grid.enableMove === 'function') grid.enableMove(isEditable)
      if (typeof grid.enableResize === 'function') grid.enableResize(isEditable)
      if (grid.opts) grid.opts.minRow = editMinRow
      grid._updateContainerHeight?.()
    }, [isEditable, editMinRow])

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
        'data-readonly': props.readOnly ? 'true' : 'false',
        'data-editing': isEditable ? 'true' : 'false',
        'aria-readonly': props.readOnly ? 'true' : undefined,
      },
      props.children,
    )
  }
}
