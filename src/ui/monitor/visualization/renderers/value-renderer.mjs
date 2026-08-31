export function renderValueRenderer(el, { latest }) {
  const item = latest[0] || {}
  return el(
    'div',
    { className: 'dvb-viz-body dvb-viz-value-card' },
    el('span', { className: 'dvb-viz-value-name' }, item.name || ''),
    el(
      'span',
      { className: `dvb-viz-value${item.ok ? '' : ' dvb-viz-value-stale'}` },
      item.ok && item.value != null ? String(item.value) : '—',
    ),
    el('span', { className: 'dvb-viz-value-unit' }, item.ok && item.value != null && item.unit ? item.unit : ''),
  )
}
