// @ts-check

import { createHint, createPanel } from '../../components/primitives.mjs'

/**
 * Debug Timeline panel showing recent event stream.
 * Parity with Phase 7 Section 11.10.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createDebugTimelinePanel(React, t) {
  const el = React.createElement
  const Panel = createPanel(React)
  const Hint = createHint(React)

  return function DebugTimelinePanel({ events = [], onClear }) {
    const list = Array.isArray(events) ? events : []
    const listEndRef = React.useRef(null)
    const [open, setOpen] = React.useState(true)

    React.useEffect(() => {
      if (open && listEndRef.current && typeof listEndRef.current.scrollIntoView === 'function') {
        listEndRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }, [list.length, open])

    const eventLabel = (ev) => {
      if (ev.readable) return ev.readable
      const type = String(ev.type || 'event')
      if (/hit|breakpoint/.test(type)) return '命中断点'
      if (/paused|halt/.test(type)) return '目标已暂停'
      if (/start|running/.test(type)) return '调试会话已启动'
      if (/step/.test(type)) return '单步执行'
      return type
    }

    const eventTime = (ev) => {
      if (ev.time) return ev.time
      if (ev.timestamp) return new Date(ev.timestamp).toLocaleTimeString()
      return ''
    }

    const eventColor = (ev) => {
      const type = String(ev.type || '')
      if (/hit|exception|failed|breakpoint/.test(type)) return 'var(--dsw-alias-label-danger,#c62828)'
      if (/paused|halt/.test(type)) return 'var(--dsw-alias-label-warning,#f59e0b)'
      return 'var(--dsw-alias-label-info,#4f8ef7)'
    }

    return el(
      'div',
      { className: `dvb-debug-timeline${open ? ' is-open' : ''}` },
      el(
        Panel.Head,
        { onClick: () => setOpen((v) => !v) },
        el('span', { className: 'dvb-debug-timeline-head-title' }, `${open ? '▾' : '▸'} 调试事件 (最近 ${list.length} 条)`),
        list.length > 0 && onClear
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                style: { padding: '1px 6px', fontSize: '10px' },
                onClick: (e) => {
                  e.stopPropagation()
                  onClear()
                },
              },
              '清空',
            )
          : null,
      ),
      open
        ? el(
            Panel.Body,
            { className: 'dvb-debug-timeline-list' },
            el(
              'div',
              { className: 'dvb-debug-timeline-cols' },
              el('span', { className: 'dvb-debug-timeline-time' }, '时间'),
              el('span', null, '事件'),
            ),
            list.length === 0
              ? el(Hint, null, '暂无调试事件记录')
              : list.map((ev, idx) => {
                  const time = eventTime(ev)
                  const readable = eventLabel(ev)
                  let detail = ''
                  if (ev.payload) {
                    if (typeof ev.payload === 'string') detail = ev.payload
                    else if (ev.payload.bpId) detail = String(ev.payload.bpId)
                    else {
                      try {
                        detail = JSON.stringify(ev.payload)
                      } catch {
                        detail = ''
                      }
                    }
                  }
                  return el(
                    'div',
                    { key: `${idx}_${ev.timestamp || ev.time || idx}`, className: 'dvb-debug-timeline-entry' },
                    el('span', { className: 'dvb-debug-timeline-time' }, time),
                    el(
                      'span',
                      { className: 'dvb-debug-timeline-event' },
                      el('span', { className: 'dvb-debug-timeline-dot', style: { color: eventColor(ev) } }, '●'),
                      el('span', { className: 'dvb-debug-timeline-type' }, readable),
                      detail ? el('span', { className: 'dvb-debug-timeline-detail' }, ` ${detail}`) : null,
                    ),
                  )
                }),
            el('div', { ref: listEndRef }),
          )
        : null,
    )
  }
}
