// @ts-check

/**
 * Call Stack panel showing execution frames.
 * Parity with Phase 7 Section 11.7.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createStackPanel(React, t) {
  const el = React.createElement

  return function StackPanel({ stack = [], selectedFrame = 0, onSelectFrame }) {
    const frames = Array.isArray(stack) ? stack : []

    return el(
      'div',
      { className: 'dvb-debug-panel' },
      el(
        'div',
        { className: 'dvb-debug-panel-head' },
        el('span', null, '调用栈 (Call Stack)'),
        el('span', { className: 'dvb-hint' }, `${frames.length} 帧`),
      ),
      el(
        'div',
        { className: 'dvb-debug-panel-body' },
        frames.length === 0
          ? el(
              'div',
              { className: 'dvb-hint', style: { padding: '8px', textAlign: 'center' } },
              '无调用栈信息（调试器未暂停或未连接）',
            )
          : frames.map((frame) => {
              const level = frame.level != null ? Number(frame.level) : 0
              const isSelected = level === selectedFrame
              const fnName = frame.function || frame.func || '??'
              const filePart = frame.file ? frame.file.split(/[\\/]/).pop() : ''
              const loc = filePart ? `${filePart}${frame.line ? `:${frame.line}` : ''}` : frame.address || ''

              return el(
                'div',
                {
                  key: level,
                  className: `dvb-debug-item ${isSelected ? 'is-active' : ''}`,
                  onClick: () => onSelectFrame && onSelectFrame(level, frame),
                },
                el(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
                  el('span', { style: { opacity: 0.6, fontFamily: 'ui-monospace, monospace' } }, `#${level}`),
                  el(
                    'span',
                    {
                      style: {
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    fnName,
                  ),
                ),
                loc
                  ? el(
                      'span',
                      {
                        style: {
                          opacity: 0.7,
                          fontSize: '10px',
                          fontFamily: 'ui-monospace, monospace',
                          flex: 'none',
                        },
                      },
                      loc,
                    )
                  : null,
              )
            }),
      ),
    )
  }
}
