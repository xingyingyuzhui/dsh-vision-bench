import { formatClock } from './value-renderer.mjs'

export function renderSwitchWidget(el, spec = {}) {
  const s = spec.settings || {}
  const on = !!spec.on
  const busy = !!spec.busy
  const offline = !!spec.offline
  const showTitle = s.showTitle !== false
  const styleKind = s.switchStyle === 'buttons' ? 'buttons' : 'toggle'
  const size = s.switchSize || 'md'
  const onLabel = s.onLabel || '已开启'
  const offLabel = s.offLabel || '已关闭'
  const radius = Number(s.cardRadius) || 8
  const time = s.showUpdatedAt === false ? '' : formatClock(spec.at)
  const wrapStyle = {
    background: s.cardBg || undefined,
    borderRadius: radius + 'px',
    borderWidth: s.cardBorder === false ? 0 : undefined,
    '--dvb-viz-on': s.onColor || '#4D85FF',
    '--dvb-viz-off': s.offColor || '#B8C0CC',
  }
  const disabled = busy || offline || spec.readOnly
  const stateText = busy ? '执行中' : offline ? '离线' : on ? onLabel : offLabel
  const toggle = el(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': on,
      className: 'dvb-viz-opt-btn dvb-viz-switch-toggle',
      'data-size': size,
      disabled,
      title: spec.readOnlyTitle,
      onClick() {
        if (disabled || typeof spec.onToggle !== 'function') return
        spec.onToggle(!on)
      },
    },
    el('span', { className: `dvb-switch${on ? ' is-on' : ''}` }, el('span', { className: 'dvb-switch-track' })),
    el('span', { className: 'dvb-viz-switch-label' }, stateText),
  )
  const buttons = el(
    'div',
    { className: 'dvb-actions dvb-viz-switch-btns', 'data-size': size },
    el(
      'button',
      {
        type: 'button',
        className: `dvb-btn dvb-btn-sm${on ? ' dvb-btn-primary' : ''}`,
        disabled,
        title: spec.readOnlyTitle,
        onClick() {
          if (!disabled && typeof spec.onToggle === 'function') spec.onToggle(true)
        },
      },
      onLabel,
    ),
    el(
      'button',
      {
        type: 'button',
        className: `dvb-btn dvb-btn-sm${on ? '' : ' dvb-btn-primary'}`,
        disabled,
        title: spec.readOnlyTitle,
        onClick() {
          if (!disabled && typeof spec.onToggle === 'function') spec.onToggle(false)
        },
      },
      offLabel,
    ),
  )
  const feedback =
    s.showFeedback === false
      ? null
      : el(
          'div',
          { className: 'dvb-viz-value-status' },
          el('span', { className: 'dvb-viz-value-dot', 'data-kind': offline ? 'offline' : busy ? 'busy' : on ? 'ok' : 'idle' }),
          `设备反馈: ${stateText}`,
        )
  return el(
    'div',
    { className: 'dvb-viz-body dvb-viz-switch-card', style: wrapStyle },
    showTitle ? el('span', { className: 'dvb-viz-value-name' }, spec.name || '') : null,
    spec.confirmHint ? el('div', { className: 'dvb-hint' }, spec.confirmHint) : null,
    styleKind === 'buttons' ? buttons : toggle,
    feedback,
    el(
      'div',
      { className: 'dvb-viz-switch-meta' },
      s.hintText ? el('span', { className: 'dvb-hint' }, s.hintText) : null,
      time ? el('span', { className: 'dvb-viz-value-time' }, `更新于 ${time}`) : null,
    ),
  )
}

export function renderSwitchRenderer(el, spec) {
  const item = spec.item || {}
  return renderSwitchWidget(el, {
    ...spec,
    name: spec.name || item.name,
    on: spec.on,
    offline: spec.offline != null ? spec.offline : item.ok === false,
    at: spec.at || item.at,
    settings: spec.settings,
  })
}
