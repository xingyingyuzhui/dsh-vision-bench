/**
 * @param {string} buildOut
 */
export function parseBuildErrors(buildOut) {
  const text = String(buildOut || '')
  const out = []
  const re = /^\s*(.+?)\((\d+)\)\s*:\s*(error|fatal error|warning)\s*:\s*(.*)$/gm
  for (const m of text.matchAll(re)) {
    out.push({
      file: m[1].trim(),
      line: Math.max(1, Number(m[2]) || 1),
      kind: m[3],
      text: m[4].trim().slice(0, 200),
    })
  }
  return out.slice(0, 60)
}

/**
 * @param {any} React
 */
export function createKeilBuildErrorList(React) {
  const el = React.createElement
  return function KeilBuildErrorList(props) {
    const { buildErrors, jumpToError } = props
    if (!buildErrors || !buildErrors.length) return null

    return el(
      'div',
      { className: 'dvb-map-funcs' },
      buildErrors.slice(0, 30).map((err, idx) =>
        el(
          'div',
          {
            key: `e${idx}`,
            className: 'dvb-map-func',
            'data-kind': err.kind === 'error' || err.kind === 'fatal error' ? 'err' : 'warn',
          },
          el('span', { className: 'dvb-map-func-name' }, err.file),
          el('span', { className: 'dvb-map-meta' }, `:${err.line} ${err.kind}`),
          el('span', { className: 'dvb-hint', title: err.text }, err.text.slice(0, 120)),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              title: '打开工程结构并定位到该文件/行',
              onClick() {
                jumpToError(err)
              },
            },
            '定位',
          ),
        ),
      ),
    )
  }
}
