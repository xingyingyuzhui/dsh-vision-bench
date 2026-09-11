const pad2 = (n) => (n < 10 ? '0' : '') + n

export function formatClock(at) {
  if (!at) return ''
  const d = new Date(Number(at))
  if (!Number.isFinite(d.getTime())) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function formatVizValue(value, s = {}) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null
  const n = Number(value)
  const d = s.valueDecimals
  const core = d === '' || d == null ? String(n) : n.toFixed(Number(d))
  return `${s.valuePrefix || ''}${core}${s.valueSuffix || ''}`
}

export function valueStatus(value, ok, s = {}) {
  if (!ok) return 'offline'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'offline'
  if (s.statusHi != null && s.statusHi !== '' && n >= Number(s.statusHi)) return 'alarm'
  if (s.statusLo != null && s.statusLo !== '' && n <= Number(s.statusLo)) return 'alarm'
  return 'ok'
}

const STATUS_LABEL = { ok: '正常', alarm: '告警', offline: '离线' }

export function renderValueWidget(el, spec = {}) {
  const s = spec.settings || {}
  const empty = !!spec.empty
  const ok = !empty && spec.ok
  const text = empty || !ok || spec.value == null ? s.emptyText || '—' : formatVizValue(spec.value, s)
  const unit = s.yUnit || spec.unit || ''
  const align = s.valueAlign === 'center' ? 'center' : 'left'
  const below = s.unitPos === 'below'
  const size = Number(s.valueSize) || 48
  const radius = Number(s.cardRadius) || 8
  const status = s.showStatus === false ? '' : valueStatus(spec.value, ok, s)
  const time = s.showUpdatedAt === false ? '' : formatClock(spec.at)
  const style = {
    textAlign: align,
    alignItems: align === 'center' ? 'center' : 'flex-start',
    background: s.cardBg || undefined,
    borderRadius: radius + 'px',
    borderWidth: s.cardBorder === false ? 0 : undefined,
  }
  const valueStyle = { fontSize: size + 'px', color: s.valueColor || undefined }
  const valueEl = el('span', { key: 'v', className: `dvb-viz-value${ok ? '' : ' dvb-viz-value-stale'}`, style: valueStyle }, text)
  const unitEl = unit ? el('span', { key: 'u', className: 'dvb-viz-value-unit' }, unit) : null
  const valueRow = below ? [valueEl, unitEl] : el('div', { className: 'dvb-viz-value-row' }, valueEl, unitEl)
  return el(
    'div',
    { className: 'dvb-viz-body dvb-viz-value-card', 'data-align': align, style },
    s.showTitle === false ? null : el('span', { className: 'dvb-viz-value-name' }, spec.name || ''),
    valueRow,
    status
      ? el(
          'div',
          { className: 'dvb-viz-value-status' },
          el('span', { className: 'dvb-viz-value-dot', 'data-kind': status }),
          STATUS_LABEL[status] || status,
        )
      : null,
    time ? el('span', { className: 'dvb-viz-value-time' }, empty ? '暂无数据' : `更新于 ${time}`) : null,
  )
}

export function renderValueRenderer(el, { latest, settings, name }) {
  const item = latest[0] || {}
  return renderValueWidget(el, {
    settings,
    name: name || item.name,
    value: item.value,
    ok: item.ok,
    unit: item.unit,
    at: item.at,
  })
}
