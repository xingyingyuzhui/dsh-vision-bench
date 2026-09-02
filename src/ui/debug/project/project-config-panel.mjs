export function createProjectConfigPanel(React, t) {
  return function ProjectConfigPanel({ mapped, counts, cfgOpen, onToggle }) {
    const el = React.createElement
    if (!mapped?.includes?.length) return null
    const truncated = mapped?.truncated && typeof mapped.truncated === 'object' ? mapped.truncated : {}
    return el(
      'div',
      { className: 'dvb-map-block' },
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-sm dvb-map-cfg-toggle',
          onClick: onToggle,
        },
        `${cfgOpen ? '▾ ' : '▸ '}${t('mapIncludes')} · ${String(counts.includes || mapped.includes.length)} · ${(mapped.defines || []).length} 宏 · ${String(counts.include_edges || (mapped.include_edges || []).length)} 依赖`,
      ),
      truncated.include_edges || truncated.includes || truncated.defines
        ? el('div', { className: 'dvb-hint dvb-need' }, t('mapTruncated'))
        : null,
      cfgOpen
        ? el(
            'div',
            null,
            el('div', { className: 'dvb-map-label' }, t('mapIncludes')),
            mapped.includes.map((item, index) =>
              el(
                'div',
                {
                  key: `i${index}`,
                  className: 'dvb-map-path',
                  'data-kind': item.exists ? (item.inside ? 'ok' : 'out') : 'missing',
                },
                item.path,
              ),
            ),
            mapped.defines?.length ? el('div', { className: 'dvb-map-label' }, t('mapDefines')) : null,
            mapped.defines ? el('div', { className: 'dvb-map-defs' }, mapped.defines.join(', ')) : null,
            mapped.include_edges?.length ? el('div', { className: 'dvb-map-label' }, t('mapIncludesOf')) : null,
            mapped.include_edges
              ? mapped.include_edges.slice(0, 120).map((edge, index) =>
                  el(
                    'div',
                    {
                      key: `e${index}`,
                      className: 'dvb-map-path',
                      'data-kind': edge.resolved ? 'ok' : 'missing',
                    },
                    `${edge.from || ''} → ${edge.to || edge.name || ''}`,
                  ),
                )
              : null,
          )
        : null,
    )
  }
}
