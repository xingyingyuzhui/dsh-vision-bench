// @ts-check

/**
 * Function Detail Panel (函数详情抽屉)
 * Renders function metadata, signature, caller/callee relations, mini code snippet,
 * and quick action to locate and open the source file.
 *
 * @param {any} React
 * @param {(key: string) => string} [t]
 */

/** @param {any} funcNode */
export function functionSnippetView(funcNode) {
  const start = Math.max(1, Number(funcNode?.snippetStartLine || funcNode?.line || 1) || 1)
  const text = funcNode?.snippet
  if (text == null || String(text) === '') return { start, lines: [] }
  return { start, lines: String(text).split('\n') }
}

function relationLocation(rel, currentFile) {
  if (rel?.expanded === false) return { text: '当前层级未展开', unexpanded: true }
  const loc = rel?.location && rel.location !== '当前层级未展开'
    ? rel.location
    : rel?.file
      ? `${rel.file}:${rel.line || 1}`
      : rel?.line
        ? `${currentFile}:${rel.line}`
        : ''
  return { text: loc, unexpanded: false }
}

export function createFunctionDetailPanel(React, t) {
  const el = React.createElement

  return function FunctionDetailPanel({
    funcNode, onClose, onSelectNode, onExpandNextLevel, onLocateSource,
  }) {
    if (!funcNode) return null

    const name = funcNode.label || funcNode.name || ''
    const fileName = funcNode.file || (funcNode.location ? String(funcNode.location).split(':')[0] : '')
    const line = Number(funcNode.line || (funcNode.location ? String(funcNode.location).split(':')[1] : 0)) || 0
    const signature = funcNode.signature || (name ? `${name}()` : '')
    const callers = Array.isArray(funcNode.callers) ? funcNode.callers : []
    const callees = Array.isArray(funcNode.callees) ? funcNode.callees : []
    const snippet = functionSnippetView(funcNode)

    const relRow = (c, key, onClick, loc) =>
      el('div', { key, className: 'dvb-function-rel-row', onClick },
        el('span', { className: 'dvb-function-rel-glyph' }, 'ƒ'),
        el('span', { className: 'dvb-function-rel-name' }, c.name),
        loc.text
          ? el('span', { className: `dvb-function-rel-loc${loc.unexpanded ? ' is-unexpanded' : ''}` }, loc.text)
          : null,
      )

    const pRow = (lbl, val, isCol) =>
      el('div', { className: `dvb-function-prop-row${isCol ? ' dvb-function-prop-col' : ''}` },
        el('span', { className: 'dvb-function-prop-label' }, lbl), val)

    return el('div', { className: 'dvb-function-detail' },
      el('div', { className: 'dvb-function-detail-head' },
        el('span', { className: 'dvb-function-detail-title' }, '函数详情'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm dvb-btn-icon dvb-function-detail-close', 'aria-label': '关闭', onClick: onClose }, '✕'),
      ),
      el('div', { className: 'dvb-function-detail-body' },
        el('div', { className: 'dvb-function-detail-identity' },
          el('span', { className: 'dvb-function-glyph' }, 'ƒ'),
          el('span', { className: 'dvb-function-name' }, name),
          el('span', { className: 'dvb-badge dvb-badge-info' }, '函数'),
          fileName || line
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-function-file-link',
                  onClick: () => onLocateSource?.(fileName, line),
                },
                [fileName || '', line ? `:${line}` : ''].join('') || '—',
              )
            : null,
        ),
        signature
          ? el('div', { className: 'dvb-function-props' },
              pRow('函数签名', el('div', { className: 'dvb-function-sig-box' }, signature), true),
            )
          : null,
        el('div', { className: 'dvb-function-section' },
          el('div', { className: 'dvb-function-sec-title' }, '调用关系'),
          el('div', { className: 'dvb-function-sub-title' }, `调用者（${callers.length}）`),
          callers.length
            ? callers.map((c, i) => relRow(c, `c-${i}`, () => onSelectNode?.(c.id || c.name), relationLocation(c, fileName)))
            : el('div', { className: 'dvb-function-empty-rel' }, '无上级调用者'),
          el('div', { className: 'dvb-function-sub-title' }, `被调用者（${callees.length}）`),
          callees.length
            ? callees.map((c, i) => relRow(c, `e-${i}`,
                () => (c.expanded === false ? onExpandNextLevel?.(c) : onSelectNode?.(c.id || c.name)),
                relationLocation(c, fileName)))
            : el('div', { className: 'dvb-function-empty-rel' }, '无子函数调用'),
          onExpandNextLevel && callees.some((c) => c.expanded === false)
            ? el('button', { type: 'button', className: 'dvb-btn dvb-function-expand-btn', onClick: () => onExpandNextLevel(funcNode) }, '展开下一级')
            : null,
        ),
        el('div', { className: 'dvb-function-section' },
          el('div', { className: 'dvb-function-sec-title' }, '源码片段'),
          snippet.lines.length
            ? el('div', { className: 'dvb-function-snippet-box' },
                snippet.lines.map((l, i) => el('div', { key: i, className: 'dvb-function-snippet-line' },
                  el('span', { className: 'dvb-function-line-num' }, String(snippet.start + i)),
                  el('span', { className: 'dvb-function-line-code' }, l),
                )),
              )
            : el('div', { className: 'dvb-function-empty-rel' }, '没有可用的源码片段'),
          el('button', { type: 'button', className: 'dvb-btn dvb-btn-primary dvb-function-locate-btn', onClick: () => onLocateSource?.(fileName, line) }, '定位源码'),
        ),
      ),
    )
  }
}
