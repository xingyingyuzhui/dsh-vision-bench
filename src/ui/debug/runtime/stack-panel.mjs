// @ts-check

import { createHint, createPanel } from '../../components/primitives.mjs'

/**
 * Call Stack panel showing execution frames.
 * Parity with Phase 7 Section 11.7.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createStackPanel(React, t) {
  const el = React.createElement
  const Panel = createPanel(React)
  const Hint = createHint(React)

  return function StackPanel({ stack = [], selectedFrame = 0, onSelectFrame }) {
    const frames = Array.isArray(stack) ? stack : []

    return el(
      Panel,
      null,
      el(Panel.Head, null, el('span', { className: 'dvb-debug-panel-title' }, `调用栈 (${frames.length})`)),
      el(
        Panel.Body,
        { className: 'dvb-debug-stack-list' },
        frames.length === 0
          ? el(Hint, null, '无调用栈信息（调试器未暂停或未连接）')
          : frames.map((frame) => {
              const level = frame.level != null ? Number(frame.level) : 0
              const isSelected = level === selectedFrame
              const rawName = frame.function || frame.func || '??'
              const fnName = rawName.includes('(') ? rawName : `${rawName}()`
              const filePart = frame.file ? frame.file.split(/[\\/]/).pop() : ''
              const loc = filePart ? `${filePart}${frame.line ? `:${frame.line}` : ''}` : frame.address || ''

              return el(
                'div',
                {
                  key: level,
                  className: `dvb-debug-item dvb-debug-stack-item ${isSelected ? 'is-active' : ''}`,
                  onClick: () => onSelectFrame && onSelectFrame(level, frame),
                },
                el(
                  'div',
                  { className: 'dvb-debug-stack-left' },
                  el('span', { className: 'dvb-debug-stack-num' }, String(level + 1)),
                  el('span', { className: 'dvb-debug-stack-fn' }, fnName),
                ),
                loc
                  ? el(
                      'span',
                      { className: 'dvb-debug-stack-loc' },
                      loc,
                    )
                  : null,
              )
            }),
      ),
    )
  }
}
