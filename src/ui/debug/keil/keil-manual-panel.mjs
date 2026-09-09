/**
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createKeilManualPanel(React, t) {
  const el = React.createElement
  return function KeilManualPanel(props) {
    const { openManual, resolveManual } = props
    if (!openManual || !openManual.length) return null

    return el(
      'div',
      { className: 'dvb-panel dvb-write-panel' },
      el('div', { className: 'dvb-panel-head' }, el('span', { className: 'dvb-panel-title' }, t('manualTitle'))),
      openManual.map((req) =>
        el(
          'div',
          { key: req.id, className: 'dvb-task' },
          el(
            'span',
            { className: 'dvb-badge', 'data-source': req.sessionId ? 'agent' : 'user' },
            req.sessionId ? 'Agent' : 'User',
          ),
          el('span', { className: 'dvb-hint' }, req.text),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-primary',
              onClick() {
                resolveManual(req.id, true)
              },
            },
            t('manualDone'),
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn',
              onClick() {
                resolveManual(req.id, false)
              },
            },
            t('manualFail'),
          ),
        ),
      ),
    )
  }
}
