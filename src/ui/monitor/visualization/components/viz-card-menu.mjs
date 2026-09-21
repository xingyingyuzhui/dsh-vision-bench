import { toBodyPortal } from '../../../common/body-portal.mjs'

function iconEllipsis(el) {
  return el(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
    el('circle', { cx: 3.5, cy: 8, r: 1.35 }),
    el('circle', { cx: 8, cy: 8, r: 1.35 }),
    el('circle', { cx: 12.5, cy: 8, r: 1.35 }),
  )
}

export function createVizCardMenu(React) {
  const el = React.createElement

  return function VizCardMenu({ items = [], label = '组件操作' }) {
    const [open, setOpen] = React.useState(false)
    const btnRef = React.useRef(null)
    const listRef = React.useRef(null)
    const [box, setBox] = React.useState(null)

    function place() {
      const node = btnRef.current
      if (!node || typeof node.getBoundingClientRect !== 'function') return
      const r = node.getBoundingClientRect()
      const width = 218
      const left = Math.max(8, Math.min(r.right - width, (globalThis.innerWidth || 800) - width - 8))
      setBox({ top: r.bottom + 4, left })
    }

    React.useEffect(() => {
      if (!open) return
      place()
      const onDoc = (e) => {
        const t = e.target
        if (btnRef.current && btnRef.current.contains(t)) return
        if (listRef.current && listRef.current.contains(t)) return
        setOpen(false)
      }
      const onKey = (e) => {
        if (e.key === 'Escape') setOpen(false)
      }
      document.addEventListener('mousedown', onDoc)
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      return () => {
        document.removeEventListener('mousedown', onDoc)
        window.removeEventListener('keydown', onKey)
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
      }
    }, [open])

    return el(
      'div',
      { className: 'dvb-viz-more-wrap' },
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-viz-more',
          ref: btnRef,
          'aria-label': label,
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onPointerDown(e) {
            e.stopPropagation()
          },
          onClick(e) {
            e.stopPropagation()
            setOpen((v) => !v)
          },
        },
        iconEllipsis(el),
      ),
      open && box
        ? toBodyPortal(
            el(
              'div',
              {
                className: 'dvb-viz-overflow',
                role: 'menu',
                ref: listRef,
                style: { top: box.top + 'px', left: box.left + 'px' },
              },
              items.map((it) =>
                el(
                  'button',
                  {
                    key: it.id,
                    type: 'button',
                    role: 'menuitem',
                    className: `dvb-viz-overflow-item${it.danger ? ' is-danger' : ''}`,
                    disabled: !!it.disabled,
                    'aria-label': it.ariaLabel || it.label,
                    onClick(e) {
                      e.stopPropagation()
                      if (it.disabled) return
                      setOpen(false)
                      it.onSelect?.()
                    },
                  },
                  el('span', { className: 'dvb-viz-overflow-label' }, it.label),
                ),
              ),
            ),
          )
        : null,
    )
  }
}
