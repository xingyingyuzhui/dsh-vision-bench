// @ts-check

/**
 * Debug Timeline panel showing recent event stream.
 * Parity with Phase 7 Section 11.10.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createDebugTimelinePanel(React, t) {
  const el = React.createElement

  return function DebugTimelinePanel({ events = [], onClear }) {
    const list = Array.isArray(events) ? events : []
    const listEndRef = React.useRef(null)

    React.useEffect(() => {
      if (listEndRef.current && typeof listEndRef.current.scrollIntoView === 'function') {
        listEndRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }, [list.length])

    return el(
      'div',
      { className: 'dvb-debug-timeline' },
      el(
        'div',
        { className: 'dvb-debug-panel-head' },
        el('span', null, `调试时间线 (Event Stream · 最近 ${list.length} 条)`),
        list.length > 0 && onClear
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                style: { padding: '1px 6px', fontSize: '10px' },
                onClick: onClear,
              },
              '清空',
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-debug-timeline-list' },
        list.length === 0
          ? el('div', { className: 'dvb-hint', style: { padding: '4px' } }, '暂无调试事件记录')
          : list.map((ev, idx) => {
              const time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ''
              const type = String(ev.type || 'event')
              let typeColor = 'inherit'
              if (type.includes('hit') || type.includes('exception') || type.includes('failed')) {
                typeColor = 'var(--dsw-alias-label-danger, #c62828)'
              } else if (type.includes('running')) {
                typeColor = 'var(--dsw-alias-label-success, #2e7d32)'
              } else if (type.includes('paused') || type.includes('step')) {
                typeColor = 'var(--dsw-alias-label-info, #4f8ef7)'
              }

              let detail = ''
              if (ev.payload) {
                if (typeof ev.payload === 'string') detail = ev.payload
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
                { key: `${idx}_${ev.timestamp || idx}`, className: 'dvb-debug-timeline-entry' },
                time ? el('span', { className: 'dvb-debug-timeline-time' }, `[${time}]`) : null,
                el('span', { className: 'dvb-debug-timeline-type', style: { color: typeColor } }, type),
                detail
                  ? el('span', { style: { opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis' } }, detail)
                  : null,
              )
            }),
        el('div', { ref: listEndRef }),
      ),
    )
  }
}
