import { getTableRuntime } from '../vendor/table-runtime.mjs'

const ESTIMATE_SIZE = 36
const FALLBACK_CAP = 30

function colId(col, index) {
  return String(col.id || col.accessorKey || index)
}

function readCellValue(col, original, index) {
  if (typeof col.accessorFn === 'function') return col.accessorFn(original, index)
  if (col.accessorKey) return original[col.accessorKey]
  return undefined
}

function renderDef(def, ctx, fallback) {
  if (typeof def === 'function') return def(ctx)
  if (def == null || def === '') return fallback
  return def
}

function createFallbackTable(options) {
  const data = Array.isArray(options.data) ? options.data : []
  const columns = Array.isArray(options.columns) ? options.columns : []
  const getRowId = options.getRowId
  const rows = data.map((original, index) => {
    const id = String(getRowId(original, index) || '')
    const cells = columns.map((col, ci) => {
      const getValue = () => readCellValue(col, original, index)
      const ctx = { row: { id, original }, column: { columnDef: col }, getValue, renderValue: getValue }
      return {
        id: colId(col, ci),
        column: { columnDef: col, getCanSort: () => false },
        getValue,
        getContext: () => ctx,
      }
    })
    return { id, original, getVisibleCells: () => cells }
  })
  return {
    getHeaderGroups: () => [
      {
        id: 'header',
        headers: columns.map((col, ci) => ({
          id: colId(col, ci),
          column: {
            columnDef: col,
            getCanSort: () => false,
            getIsSorted: () => false,
            getToggleSortingHandler: () => undefined,
          },
        })),
      },
    ],
    getRowModel: () => ({ rows }),
  }
}

function gridTemplate(columns) {
  return columns
    .map((col) => {
      if (col.size) return `${Number(col.size)}px`
      if (col.minSize) return `minmax(${Number(col.minSize)}px, 1fr)`
      return 'minmax(64px, 1fr)'
    })
    .join(' ')
}

function useHeadlessTable(React, options) {
  const runtime = getTableRuntime()
  const [sorting, setSorting] = React.useState([])
  const tableRef = React.useRef(null)
  const resolved = {
    data: options.data,
    columns: options.columns,
    getRowId: options.getRowId,
    state: {
      sorting,
      ...(options.columnVisibility ? { columnVisibility: options.columnVisibility } : {}),
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: options.onColumnVisibilityChange || undefined,
    getCoreRowModel: runtime ? runtime.getCoreRowModel() : undefined,
    getSortedRowModel: runtime?.getSortedRowModel ? runtime.getSortedRowModel() : undefined,
    renderFallbackValue: null,
    onStateChange: () => {},
  }
  if (!runtime) return createFallbackTable(resolved)
  if (!tableRef.current) tableRef.current = runtime.createTable(resolved)
  tableRef.current.setOptions((prev) => ({
    ...prev,
    ...resolved,
    state: {
      ...tableRef.current.initialState,
      ...resolved.state,
    },
  }))
  return tableRef.current
}

/** Headless table UI. Pages pass React + row ids; this module never talks to Host. */
export function createDataTable(React) {
  const el = React.createElement
  return function DataTable(props) {
    if (typeof props.getRowId !== 'function') throw new Error('DataTable requires getRowId')
    const data = Array.isArray(props.data) ? props.data : []
    const columns = Array.isArray(props.columns) ? props.columns : []
    const table = useHeadlessTable(React, {
      data,
      columns,
      getRowId: props.getRowId,
      columnVisibility: props.columnVisibility,
      onColumnVisibilityChange: props.onColumnVisibilityChange,
    })
    const rows = table.getRowModel().rows
    const virtualize = !!props.virtualize
    const estimateSize = Number(props.estimateSize) > 0 ? Number(props.estimateSize) : ESTIMATE_SIZE
    const overscan = Number(props.overscan) > 0 ? Number(props.overscan) : 10
    const fallbackCap = Number(props.fallbackCap) > 0 ? Number(props.fallbackCap) : FALLBACK_CAP
    const innerRef = React.useRef(null)
    const scrollRef = props.listRef || innerRef
    const useViz = typeof props.useVirtualizer === 'function' ? props.useVirtualizer : () => null
    const vizer = useViz({
      count: virtualize ? rows.length : 0,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => estimateSize,
      overscan,
      getItemKey: (index) => {
        const row = rows[index]
        return row?.id ? row.id : `missing:${index}`
      },
      onChange: (instance) => {
        if (typeof props.onVirtualizerChange === 'function') props.onVirtualizerChange(instance)
      },
    })
    if (typeof props.onVirtualizer === 'function') props.onVirtualizer(vizer)
    const measureRow =
      vizer && typeof vizer.measureElement === 'function' ? (node) => node && vizer.measureElement(node) : undefined
    const virtualItems = vizer?.getVirtualItems ? vizer.getVirtualItems() : []
    const totalHeight = vizer?.getTotalSize ? vizer.getTotalSize() : rows.length * estimateSize
    let visible
    if (vizer) {
      visible = virtualItems.map((item) => ({ item, row: rows[item.index] }))
    } else if (virtualize && rows.length > fallbackCap) {
      visible = rows.slice(0, fallbackCap).map((row, index) => ({
        item: { index, start: index * estimateSize, size: estimateSize, key: row.id },
        row,
      }))
    } else {
      visible = rows.map((row, index) => ({
        item: { index, start: index * estimateSize, size: estimateSize, key: row.id },
        row,
      }))
    }
    const absRows = virtualize
    const selectedId = props.selectedId == null ? '' : String(props.selectedId)
    const template = gridTemplate(columns)
    const head = table.getHeaderGroups().map((group) =>
      el(
        'div',
        {
          key: group.id,
          className: 'dvb-data-table-head',
          role: 'row',
          style: { gridTemplateColumns: template },
        },
        group.headers.map((header) => {
          const canSort = header.column.getCanSort?.()
          const sorted = header.column.getIsSorted ? header.column.getIsSorted() : false
          const label = renderDef(
            header.column.columnDef.header,
            header.getContext ? header.getContext() : {},
            header.id,
          )
          const mark = sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''
          return el(
            'div',
            { key: header.id, className: 'dvb-data-th', role: 'columnheader' },
            canSort
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-data-th-sort',
                    onClick: header.column.getToggleSortingHandler?.(),
                  },
                  label,
                  mark,
                )
              : label,
          )
        }),
      ),
    )
    function moveSelection(delta) {
      if (!rows.length || typeof props.onRowClick !== 'function') return
      const ids = rows.map((row) => String(row.id))
      const cur = ids.indexOf(selectedId)
      const next = Math.max(0, Math.min(ids.length - 1, (cur < 0 ? 0 : cur) + delta))
      const row = rows[next]
      if (row) props.onRowClick(row.original, row.id)
    }
    const bodyRows = visible.map(({ item, row }) => {
      if (!row) return null
      const extra = typeof props.getRowProps === 'function' ? props.getRowProps(row, item) || {} : {}
      const isOn = selectedId && String(row.id) === selectedId
      const { className: extraClass = '', style: extraStyle, onClick: extraOnClick, ...rest } = extra
      const className = ['dvb-data-table-row', isOn ? 'is-on' : '', extraClass].filter(Boolean).join(' ')
      const style = absRows
        ? {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start}px)`,
            height: `${item.size || estimateSize}px`,
            gridTemplateColumns: template,
            ...(extraStyle || {}),
          }
        : { gridTemplateColumns: template, ...(extraStyle || {}) }
      return el(
        'div',
        {
          key: row.id || item.key,
          role: 'row',
          tabIndex: -1,
          ref: measureRow,
          'data-index': item.index,
          'data-rowid': row.id,
          ...rest,
          className,
          style,
          onClick() {
            if (typeof props.onRowClick === 'function') props.onRowClick(row.original, row.id)
            if (typeof extraOnClick === 'function') extraOnClick()
          },
        },
        row
          .getVisibleCells()
          .map((cell) =>
            el(
              'div',
              { key: cell.id, className: 'dvb-data-td', role: 'cell' },
              renderDef(cell.column.columnDef.cell, cell.getContext(), cell.getValue ? cell.getValue() : null),
            ),
          ),
      )
    })
    const height = props.height || 320
    const wrapStyle = virtualize
      ? { height: typeof height === 'number' ? `${height}px` : height, overflowY: 'auto', position: 'relative' }
      : { position: 'relative' }
    return el(
      'div',
      { className: `dvb-data-table ${props.className || ''}`.trim(), role: 'table' },
      head,
      el(
        'div',
        {
          className: `dvb-data-table-scroll ${props.listClassName || ''}`.trim(),
          style: wrapStyle,
          ref: scrollRef,
          tabIndex: 0,
          onScroll: props.onScroll,
          onKeyDown(ev) {
            if (ev.key === 'ArrowDown') {
              ev.preventDefault()
              moveSelection(1)
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault()
              moveSelection(-1)
            } else if (ev.key === 'Enter' && selectedId && typeof props.onRowClick === 'function') {
              const row = rows.find((r) => String(r.id) === selectedId)
              if (row) props.onRowClick(row.original, row.id)
            }
            if (typeof props.onKeyDown === 'function') props.onKeyDown(ev)
          },
        },
        absRows
          ? el('div', { style: { height: `${totalHeight}px`, position: 'relative', width: '100%' } }, bodyRows)
          : el('div', { className: 'dvb-data-table-body' }, bodyRows),
      ),
    )
  }
}
