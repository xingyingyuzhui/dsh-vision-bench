// @ts-check

function joinClass(base, extra) {
  return extra ? `${base} ${extra}` : base
}

/**
 * Shared panel chrome for Vision Client pages.
 * Keep `dvb-debug-panel` class names so existing runtime CSS still applies.
 *
 * @param {any} React
 */
export function createPanel(React) {
  const el = React.createElement

  function PanelHead({ className, onClick, children }) {
    return el('div', { className: joinClass('dvb-debug-panel-head', className), onClick }, children)
  }

  function PanelBody({ className, style, children }) {
    return el('div', { className: joinClass('dvb-debug-panel-body', className), style }, children)
  }

  function Panel({ className, style, children }) {
    return el('div', { className: joinClass('dvb-debug-panel', className), style }, children)
  }

  Panel.Head = PanelHead
  Panel.Body = PanelBody
  return Panel
}

/**
 * Underline tabs used by breakpoints / variables / similar section heads.
 *
 * @param {any} React
 */
export function createTabs(React) {
  const el = React.createElement
  return function Tabs({ items = [], value, onChange, className }) {
    const list = Array.isArray(items) ? items : []
    return el(
      'div',
      { className: joinClass('dvb-debug-tabs', className) },
      list.map((item) => {
        const key = String(item.key)
        const label = item.count == null ? item.label : `${item.label} (${item.count})`
        return el(
          'button',
          {
            key,
            type: 'button',
            className: `dvb-debug-subtab${value === item.key ? ' is-active' : ''}`,
            onClick: () => onChange && onChange(item.key),
          },
          label,
        )
      }),
    )
  }
}

/**
 * Centered empty/hint copy inside a panel body.
 *
 * @param {any} React
 */
export function createHint(React) {
  const el = React.createElement
  return function Hint({ children, className }) {
    return el(
      'div',
      {
        className: joinClass('dvb-hint', className),
        style: { padding: '8px', textAlign: 'center' },
      },
      children,
    )
  }
}
