/**
 * @param {any} React
 */
export function createFramesDetailDrawer(React) {
  const el = React.createElement
  return function FramesDetailDrawer({ frame }) {
    if (!frame) return null
    const srcLabel = frame.source === 'agent' ? 'Agent' : frame.source === 'polling' ? '自动刷新' : '用户'
    return el(
      'div',
      { className: 'dvb-panel' },
      el('div', { className: 'dvb-hint' }, `发送：${frame.request || frame.hex || ''}`),
      frame.response ? el('div', { className: 'dvb-hint' }, `接收：${frame.response}`) : null,
      el('div', { className: 'dvb-hint' }, `来源：${srcLabel}`),
      el('div', { className: 'dvb-hint' }, `事务：${frame.transactionId || frame.frameId || ''}`),
      frame.sessionId ? el('div', { className: 'dvb-hint' }, `sessionId：${frame.sessionId}`) : null,
      frame.toolCallId ? el('div', { className: 'dvb-hint' }, `toolCallId：${frame.toolCallId}`) : null,
    )
  }
}
