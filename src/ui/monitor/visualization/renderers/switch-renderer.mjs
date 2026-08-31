export function renderSwitchRenderer(el, spec) {
  const item = spec.item || {}
  const pt = spec.pt || {}
  const on = spec.on
  const busy = spec.busy
  const confirmHint = spec.confirmHint
  const cwd = spec.cwd
  const onToggle = spec.onToggle
  return el(
    'div',
    { className: 'dvb-viz-body dvb-viz-switch-card' },
    el('span', { className: 'dvb-viz-value-name' }, item.name || ''),
    el('span', { className: 'dvb-viz-value' }, on ? 'ON' : 'OFF'),
    confirmHint ? el('div', { className: 'dvb-hint' }, confirmHint) : null,
    el(
      'div',
      { className: 'dvb-actions' },
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
          disabled: !cwd || !pt.function || busy || spec.readOnly,
          title: spec.readOnlyTitle,
          onClick() {
            if (typeof onToggle === 'function') onToggle(true)
          },
        },
        '开',
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-sm',
          disabled: !cwd || !pt.function || busy || spec.readOnly,
          title: spec.readOnlyTitle,
          onClick() {
            if (typeof onToggle === 'function') onToggle(false)
          },
        },
        '关',
      ),
    ),
  )
}
