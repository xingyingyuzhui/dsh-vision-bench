/**
 * Shared empty / loading / error presentation (P3-1).
 * Callers own copy and any action node; this owns ARIA + skeleton classes.
 */

/**
 * @param {Function} el
 * @param {{
 *   kind?: 'empty' | 'loading' | 'error',
 *   title?: string | null,
 *   detail?: string | null,
 *   action?: unknown,
 *   className?: string,
 * }} [options]
 */
export function renderEmptyState(el, options = {}) {
  if (!el) return null
  const { kind = 'empty', title = null, detail = null, action = null, className = '' } = options
  const role = kind === 'error' ? 'alert' : 'status'
  const classes = ['dvb-empty', className].filter(Boolean).join(' ')
  return el(
    'div',
    {
      className: classes,
      'data-kind': kind,
      role,
      'aria-live': kind === 'error' ? 'assertive' : 'polite',
      'aria-busy': kind === 'loading' ? 'true' : undefined,
    },
    title ? el('div', { className: 'dvb-empty-title' }, title) : null,
    detail ? el('div', { className: 'dvb-hint dvb-empty-detail' }, detail) : null,
    action || null,
  )
}

/**
 * @param {typeof import('react')} React
 */
export function createEmptyState(React) {
  const el = React.createElement
  return function EmptyState(props) {
    return renderEmptyState(el, props)
  }
}
