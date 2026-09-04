import { DEFAULT_POINT_COL_WIDTHS } from './hooks/use-point-col-widths.mjs'

/** Point table header for one device (edit/add may show ops col). */
export function renderPointThead(el, t, ctx) {
  const { d, editingPointsDeviceId, newPointDraft, colWidths, onStartResize, resetColWidth } = ctx || {}
  const editing = Boolean(d && editingPointsDeviceId === d.id)
  const adding = Boolean(newPointDraft && d && newPointDraft.deviceId === d.id)
  const showOps = editing || adding

  const renderTh = (colKey, label) => {
    const w = colWidths?.[colKey] || DEFAULT_POINT_COL_WIDTHS[colKey]
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
            onPointerDown: (e) => onStartResize(colKey, e, d),
            onDoubleClick: resetColWidth ? () => resetColWidth(colKey, d) : undefined,
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
      renderTh('name', t('colName')),
      renderTh('fn', t('colFn')),
      renderTh('addr', t('colAddr')),
      renderTh('value', '当前值'),
      renderTh('monitor', t('monitorOn') || '监视'),
      renderTh('scale', '倍率'),
      renderTh('offset', '偏移'),
      renderTh('unit', t('ptUnit')),
      renderTh('alarm', t('alarmOn') || '告警'),
      renderTh('min', t('ptAlarmMin')),
      renderTh('max', t('ptAlarmMax')),
      showOps
        ? el(
            'th',
            {
              className: 'dvb-col-ops',
              style: colWidths?.ops ? { width: `${colWidths.ops}px` } : undefined,
            },
            '',
          )
        : null,
    ),
  )
}

