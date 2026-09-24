/**
 * Shared filter toolbar shell (P3-2).
 * Domain options and change handlers stay in feature modules.
 */

/**
 * @param {Function} el
 * @param {{
 *   className?: string,
 *   filters?: unknown[],
 *   search?: string,
 *   searchPlaceholder?: string,
 *   onSearchChange?: (value: string) => void,
 *   onReset?: () => void,
 *   resetLabel?: string,
 * }} [options]
 */
export function renderFilterToolbar(el, options = {}) {
  if (!el) return null
  const {
    className = '',
    filters = [],
    search = '',
    searchPlaceholder = '搜索',
    onSearchChange,
    onReset,
    resetLabel = '重置',
    resetContent = null,
  } = options

  return el(
    'div',
    { className: ['dvb-filter-toolbar', className].filter(Boolean).join(' ') },
    ...filters,
    el(
      'div',
      { className: 'dvb-search-box' },
      el(
        'svg',
        {
          className: 'dvb-search-icon',
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        el('circle', { cx: 11, cy: 11, r: 8 }),
        el('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
      ),
      el('input', {
        type: 'text',
        className: 'dvb-input dvb-search-input',
        placeholder: searchPlaceholder,
        value: search,
        onChange(e) {
          if (typeof onSearchChange === 'function') onSearchChange(e.target.value)
        },
      }),
    ),
    el(
      'button',
      {
        type: 'button',
        className: 'dvb-btn dvb-btn-reset',
        onClick() {
          if (typeof onReset === 'function') onReset()
        },
      },
      resetContent != null ? resetContent : resetLabel,
    ),
  )
}

/**
 * @param {Function} el
 * @param {{ label: string, control: unknown, className?: string }} item
 */
export function renderFilterItem(el, item) {
  const { label, control, className = '' } = item
  return el(
    'div',
    { className: ['dvb-filter-item', className].filter(Boolean).join(' ') },
    el('span', { className: 'dvb-filter-label' }, label),
    control,
  )
}

/**
 * @param {typeof import('react')} React
 */
export function createFilterToolbar(React) {
  const el = React.createElement
  return function FilterToolbar(props) {
    return renderFilterToolbar(el, props)
  }
}
