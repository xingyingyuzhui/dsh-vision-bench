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
  return function Tabs({ items = [], value, onChange, className, style }) {
    const list = Array.isArray(items) ? items : []

    function selectByIndex(index) {
      if (!list.length || !onChange) return
      const next = list[((index % list.length) + list.length) % list.length]
      if (next && next.key !== value) onChange(next.key)
    }

    function onKeyDown(event) {
      if (!list.length) return
      const currentIndex = list.findIndex((item) => item.key === value)
      const safeIndex = currentIndex >= 0 ? currentIndex : 0
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault()
          selectByIndex(safeIndex + 1)
          break
        case 'ArrowLeft':
          event.preventDefault()
          selectByIndex(safeIndex - 1)
          break
        case 'Home':
          event.preventDefault()
          selectByIndex(0)
          break
        case 'End':
          event.preventDefault()
          selectByIndex(list.length - 1)
          break
        default:
          break
      }
    }

    return el(
      'div',
      {
        role: 'tablist',
        className: joinClass('dvb-debug-tabs', className),
        style,
        onKeyDown,
      },
      list.map((item) => {
        const key = String(item.key)
        const selected = value === item.key
        const label = item.count == null ? item.label : `${item.label} (${item.count})`
        return el(
          'button',
          {
            key,
            type: 'button',
            role: 'tab',
            'aria-selected': selected,
            className: `dvb-debug-subtab${selected ? ' is-active' : ''}`,
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
        style: { padding: 'var(--dvb-space-2, 8px)', textAlign: 'center' },
      },
      children,
    )
  }
}
