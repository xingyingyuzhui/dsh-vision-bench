/**
 * ToggleSwitch
 * Centralized, reusable slider switch component for DSH Vision Bench.
 * Used for boolean toggles (settings, monitored points selection, share options, etc.).
 */

export function renderToggleSwitch(el, {
  checked = false,
  disabled = false,
  onChange,
  id,
  title,
  ariaLabel,
  className = '',
  style = {},
} = {}) {
  const isOn = checked === true
  return el(
    'button',
    {
      id,
      type: 'button',
      role: 'switch',
      'aria-checked': isOn ? 'true' : 'false',
      'aria-label': ariaLabel,
      title,
      disabled: disabled === true,
      className: `dvb-setting-switch${className ? ` ${className}` : ''}`,
      'data-checked': isOn ? 'true' : 'false',
      style,
      onClick(e) {
        e.preventDefault()
        if (!disabled && onChange) onChange(!isOn)
      },
      onKeyDown(e) {
        if ((e.key === ' ' || e.key === 'Enter') && !disabled && onChange) {
          e.preventDefault()
          onChange(!isOn)
        }
      },
    },
    el('span', { className: 'dvb-setting-switch-thumb' }),
  )
}

export function createToggleSwitch(React) {
  const el = React.createElement
  return function ToggleSwitch(props) {
    return renderToggleSwitch(el, props)
  }
}
