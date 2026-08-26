/** Point table header for one device (edit/add may show ops col). */
export function renderPointThead(el, t, ctx) {
  const { d, editingPointsDeviceId, newPointDraft } = ctx
  const editing = editingPointsDeviceId === d.id
  const adding = !!(newPointDraft && newPointDraft.deviceId === d.id)
  const showOps = editing || adding
  return el(
    'thead',
    null,
    el(
      'tr',
      null,
      el('th', { className: 'dvb-col-name' }, t('colName')),
      el('th', { className: 'dvb-col-fn' }, t('colFn')),
      el('th', { className: 'dvb-col-addr' }, t('colAddr')),
      el('th', { className: 'dvb-col-value' }, '当前值'),
      el('th', { className: 'dvb-col-monitor' }, t('monitorOn') || '监视'),
      el('th', { className: 'dvb-col-alarm' }, t('alarmOn') || '告警'),
      el('th', { className: 'dvb-col-scale' }, '倍率'),
      el('th', { className: 'dvb-col-offset' }, '偏移'),
      el('th', { className: 'dvb-col-unit' }, t('ptUnit')),
      el('th', { className: 'dvb-col-min' }, t('ptAlarmMin')),
      el('th', { className: 'dvb-col-max' }, t('ptAlarmMax')),
      showOps ? el('th', { className: 'dvb-col-ops' }, '') : null,
    ),
  )
}
