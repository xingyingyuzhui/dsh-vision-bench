/** Monitor/alarm pill switch (button hit-target). */
export function renderFlagSwitch(el, t, ctx) {
  void t
  const { checked, title, onToggle, options = {} } = ctx
  const on = checked === true
  const disabled = options.disabled === true
  return el(
    'button',
    {
      type: 'button',
      className: 'dvb-switch' + (on ? ' is-on' : ''),
      title,
      disabled,
      'aria-label': title,
      'aria-pressed': on ? 'true' : 'false',
      onClick(event) {
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) onToggle(!on)
      },
    },
    el('span', { className: 'dvb-switch-track', 'aria-hidden': 'true' }),
  )
}
