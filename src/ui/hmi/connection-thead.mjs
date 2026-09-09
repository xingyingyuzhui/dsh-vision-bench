import { DEFAULT_CONN_COL_WIDTHS } from './hooks/use-conn-col-widths.mjs'

/** Connection table header supporting draggable column resizing. */
export function renderConnectionThead(el, t, ctx) {
  const { connColWidths, onStartResize, resetColWidth } = ctx || {}
  const widths = connColWidths || DEFAULT_CONN_COL_WIDTHS

  const renderTh = (colKey, label) => {
    const w = widths[colKey] || DEFAULT_CONN_COL_WIDTHS[colKey]
    return el(
      'th',
      {
        className: `dvb-col-${colKey}`,
        style: w ? { width: `${w}px` } : undefined,
      },
      el('span', { className: 'dvb-th-label' }, label),
      onStartResize
        ? el('span', {
            className: 'dvb-col-resizer',
            'data-col': colKey,
            onPointerDown: (e) => onStartResize(colKey, e),
            onDoubleClick: resetColWidth ? () => resetColWidth(colKey) : undefined,
            title: '左右拖拽调整列宽，双击恢复默认',
          })
        : null,
    )
  }

  return el(
    'thead',
    null,
    el(
      'tr',
      null,
      renderTh('name', '名称'),
      renderTh('role', t('role') || '角色'),
      renderTh('endpoint', '端点/状态'),
      renderTh('actions', '操作'),
    ),
  )
}
