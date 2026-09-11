import {
  formatFrameClock,
  formatHexDisplay,
  formatPortName,
  frameByteCount,
  frameDirection,
  framePayloadHex,
  hexToUtf8Preview,
} from './frames-format.mjs'

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
  return function FramesDetailDrawer({ frame, connections, copied, sendToAgent, hasInput }) {
    const [aiOpen, setAiOpen] = React.useState(true)
    if (!frame) {
      return el(
        'div',
        { className: 'dvb-frames-detail' },
        el(
          'div',
          { className: 'dvb-frames-detail-head' },
          el('span', { className: 'dvb-frames-detail-title' }, '报文详情'),
        ),
        el('div', { className: 'dvb-hint dvb-frames-detail-empty' }, '选择一条报文查看详情'),
      )
    }
    const hex = framePayloadHex(frame)
    const hexView = formatHexDisplay(hex)
    const textView = hexToUtf8Preview(hex)
    const dir = frameDirection(frame)
    const rx = dir === 'rx'
    const copyAll = () => {
      copyText(
        [
          `time: ${formatFrameClock(frame.t || frame.at)}`,
          `port: ${formatPortName(frame, connections)}`,
          `dir: ${dir}`,
          `hex: ${hexView}`,
          `text: ${textView}`,
        ].join('\n'),
      )
    }
    return el(
      'div',
      { className: 'dvb-frames-detail' },
      el(
        'div',
        { className: 'dvb-frames-detail-head' },
        el('span', { className: 'dvb-frames-detail-title' }, '报文详情'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: copyAll }, '复制'),
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
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-frames-ai-toggle',
          onClick: () => setAiOpen((v) => !v),
        },
        'AI 辅助分析',
        el('span', { className: 'dvb-hint' }, aiOpen ? '▾' : '▸'),
      ),
      aiOpen
        ? el(
            'div',
            { className: 'dvb-frames-ai-body' },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                onClick: () => sendToAgent?.(frame),
              },
              copied && copied !== 'copy' && copied !== 'export' ? copied : hasInput ? '发给 Agent' : '复制给 Agent',
            ),
          )
        : null,
    )
  }
}
