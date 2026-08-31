export function renderBarRenderer(el, { latest, comp, ensureChart }) {
  if (typeof ensureChart === 'function' && comp) {
    return el('div', {
      ref: (node) => {
        if (node) ensureChart(node, comp, latest)
      },
      className: 'dvb-viz-chart dvb-viz-bar-chart',
      style: { width: '100%', height: '100%', minHeight: '140px' },
    })
  }
  const nums = latest.map((l) => (l.ok && l.value != null && Number.isFinite(Number(l.value)) ? Number(l.value) : null))
  const absVals = nums.filter((v) => v !== null).map((v) => Math.abs(v))
  const maxAbs = absVals.length ? Math.max(...absVals) : 0
  const denom = maxAbs > 0 ? maxAbs : 1
  return el(
    'div',
    { className: 'dvb-viz-body' },
    el(
      'div',
      { className: 'dvb-viz-bars' },
      latest.map((item) => {
        const v = item.ok && item.value != null && Number.isFinite(Number(item.value)) ? Number(item.value) : null
        const percent = v === null ? 0 : (Math.abs(v) / denom) * 50
        return el(
          'div',
          { key: item.pointId, className: 'dvb-viz-bar-row' },
          el('span', { className: 'dvb-viz-bar-name', title: item.name }, item.name),
          el(
            'div',
            { className: 'dvb-viz-bar-track' },
            el('span', { className: 'dvb-viz-bar-zero-line', 'aria-hidden': 'true' }),
            v === null
              ? el('span', { className: 'dvb-viz-bar-missing', title: '无有效值' }, '—')
              : el('div', {
                  className: `dvb-viz-bar-fill${v < 0 ? ' dvb-viz-bar-neg' : v === 0 ? ' dvb-viz-bar-zero' : ' dvb-viz-bar-pos'}`,
                  'data-sign': v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero',
                  title: String(v) + (item.unit ? ` ${item.unit}` : ''),
                  style: v === 0 ? { width: '2px' } : { width: `${Math.max(1, percent)}%` },
                }),
          ),
          el(
            'span',
            { className: 'dvb-viz-bar-val' },
            v === null ? '—' : String(v) + (item.unit ? ` ${item.unit}` : ''),
          ),
        )
      }),
    ),
    el('div', { className: 'dvb-hint' }, '柱长按 |值| / 最大绝对值 比例；正值向右、负值向左；通信失败显示 —'),
  )
}
