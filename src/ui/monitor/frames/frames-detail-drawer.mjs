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
export function createFramesDetailDrawer(React, t) {
  const el = React.createElement
  const label = (key, params) => (typeof t === 'function' ? t(key, params) || key : key)
  return function FramesDetailDrawer({ frame, connections, sendToAgent }) {
    if (!frame) {
      return el(
        'div',
        { className: 'dvb-frames-detail' },
        el(
          'div',
          { className: 'dvb-frames-detail-head' },
          el('span', { className: 'dvb-frames-detail-title' }, label('framesDetailTitle')),
        ),
        renderEmptyState(el, {
          kind: 'empty',
          detail: label('framesDetailEmpty'),
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
        el('span', { className: 'dvb-frames-detail-title' }, label('framesDetailTitle')),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm dvb-ai-btn',
            title: label('framesAgentTitle'),
            'aria-label': label('framesAgentLabel'),
            onClick() {
              sendToAgent?.(frame)
            },
          },
          'AI',
        ),
      ),
      kv(el, label('framesTime'), formatFrameClock(frame.t || frame.at)),
      kv(el, label('framesPort'), formatPortName(frame, connections)),
      kv(
        el,
        label('framesDir'),
        el('span', { className: 'dvb-frames-dir', 'data-dir': rx ? 'rx' : 'tx' }, rx ? label('framesRx') : label('framesTx')),
      ),
      kv(el, label('framesBytes'), label('framesLen', { n: frameByteCount(frame) })),
      el('div', { className: 'dvb-frames-box-label' }, 'HEX'),
      el(
        'div',
        { className: 'dvb-frames-box' },
        el('pre', { className: 'dvb-frames-pre' }, hexView || '—'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: () => copyText(hexView) }, label('framesCopy')),
      ),
      el('div', { className: 'dvb-frames-box-label' }, 'Text (UTF-8)'),
      el(
        'div',
        { className: 'dvb-frames-box' },
        el('pre', { className: 'dvb-frames-pre' }, textView || '—'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: () => copyText(textView) }, label('framesCopy')),
      ),
      el('div', { className: 'dvb-hint' }, label('framesTextHint')),
    )
  }
}
