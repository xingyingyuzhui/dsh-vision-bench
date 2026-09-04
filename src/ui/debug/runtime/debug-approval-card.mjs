// @ts-check

/**
 * Interactive approval card for pending dangerous debug operations.
 * Parity with Phase 6 Section 10 & ADR-013.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createDebugApprovalCard(React, t) {
  const el = React.createElement

  return function DebugApprovalCard({ tickets = [], onApprove, onReject }) {
    if (!Array.isArray(tickets) || tickets.length === 0) return null

    return el(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      tickets.map((ticket) => {
        const reqId = ticket.requestId || ''
        const reason = ticket.reason || 'Agent 请求启动底层硬件调试'
        const backend = ticket.backend || 'gdb-openocd'
        const target = ticket.target || 'MCU Target'

        return el(
          'div',
          { key: reqId, className: 'dvb-debug-approval-card' },
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            el('span', { style: { fontSize: '14px' } }, '⚠️'),
            el(
              'div',
              null,
              el('span', { style: { fontWeight: 600 } }, reason),
              el('span', { style: { opacity: 0.75, marginLeft: '8px', fontSize: '11px' } }, `[${backend} / ${target}]`),
            ),
          ),
          el(
            'div',
            { style: { display: 'flex', gap: '6px' } },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                onClick: () => onApprove && onApprove(reqId),
              },
              '✓ 批准执行',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                onClick: () => onReject && onReject(reqId),
              },
              '✕ 拒绝',
            ),
          ),
        )
      }),
    )
  }
}
