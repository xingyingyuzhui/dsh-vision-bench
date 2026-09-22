import {
  formatFrameClock,
  formatHexDisplay,
  formatPortName,
  frameByteCount,
  frameDirection,
  framePayloadHex,
  hexToUtf8Preview,
} from './frames-format.mjs'
import { renderEmptyState } from '../../components/empty-state.mjs'

function copyText(text) {
  const v = String(text || '')
  if (!v) return
  try {
    navigator.clipboard.writeText(v)
  } catch {}
}

function kv(el, label, value) {
  return el(
    'div',
    { className: 'dvb-frames-kv' },
    el('span', { className: 'dvb-frames-k' }, label),
    el('span', { className: 'dvb-frames-v' }, value),
  )
}

/**
 * @param {any} React
 */
export function createFramesDetailDrawer(React) {
  const el = React.createElement
  return function FramesDetailDrawer({ frame, connections, sendToAgent }) {
    if (!frame) {
      return el(
        'div',
        { className: 'dvb-frames-detail' },
        el(
          'div',
          { className: 'dvb-frames-detail-head' },
          el('span', { className: 'dvb-frames-detail-title' }, '报文详情'),
        ),
        renderEmptyState(el, {
          kind: 'empty',
          detail: '选择一条报文查看详情',
          className: 'dvb-frames-detail-empty',
        }),
      )
    }
    const hex = framePayloadHex(frame)
    const hexView = formatHexDisplay(hex)
    const textView = hexToUtf8Preview(hex)
    const dir = frameDirection(frame)
    const rx = dir === 'rx'
    return el(
      'div',
      { className: 'dvb-frames-detail' },
      el(
        'div',
        { className: 'dvb-frames-detail-head' },
        el('span', { className: 'dvb-frames-detail-title' }, '报文详情'),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm dvb-ai-btn',
            title: '让 Agent 分析此报文',
            'aria-label': '让 Agent 分析报文',
            onClick() {
              sendToAgent?.(frame)
            },
          },
          'AI',
        ),
      ),
      kv(el, '时间', formatFrameClock(frame.t || frame.at)),
      kv(el, '端口', formatPortName(frame, connections)),
      kv(
        el,
        '方向',
        el('span', { className: 'dvb-frames-dir', 'data-dir': rx ? 'rx' : 'tx' }, rx ? 'RX 接收' : 'TX 发送'),
      ),
      kv(el, '长度', `${frameByteCount(frame)} 字节`),
      el('div', { className: 'dvb-frames-box-label' }, 'HEX'),
      el(
        'div',
        { className: 'dvb-frames-box' },
        el('pre', { className: 'dvb-frames-pre' }, hexView || '—'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: () => copyText(hexView) }, '复制'),
      ),
      el('div', { className: 'dvb-frames-box-label' }, 'Text (UTF-8)'),
      el(
        'div',
        { className: 'dvb-frames-box' },
        el('pre', { className: 'dvb-frames-pre' }, textView || '—'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: () => copyText(textView) }, '复制'),
      ),
      el('div', { className: 'dvb-hint' }, 'Text 为容错预览，原始字节以 HEX 为准。'),
    )
  }
}
