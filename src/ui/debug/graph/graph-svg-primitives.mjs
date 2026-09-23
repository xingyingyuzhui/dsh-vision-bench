// @ts-check

/**
 * Converts an array of 2D coordinates into an SVG path d attribute string.
 * @param {Array<[number, number]>} points
 * @returns {string}
 */
export function polylinePath(points) {
  if (!Array.isArray(points) || points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
}

/**
 * Calculates curved routing points between two placed rectangular nodes.
 *
 * @param {{ x: number, y: number, w: number, h: number, cy: number }} from
 * @param {{ x: number, y: number, w: number, h: number, cy: number }} to
 * @param {{ bendRatio?: number, minBend?: number, maxBend?: number }} [opts]
 * @returns {Array<[number, number]>}
 */
export function routeCurvedEdge(from, to, opts = {}) {
  const bendRatio = opts.bendRatio || 0.35
  const minBend = opts.minBend || 24
  const maxBend = opts.maxBend || 72

  const x1 = from.x + from.w
  const y1 = from.cy
  const x2 = to.x
  const y2 = to.cy
  const bend = Math.min(maxBend, Math.max(minBend, Math.abs(x2 - x1) * bendRatio))
  return [
    [x1, y1],
    [x1 + bend, y1],
    [x2 - bend, y2],
    [x2, y2],
  ]
}

/**
 * Builds a cubic-bezier SVG path `d` between two placed node rectangles.
 *
 * `polylinePath(routeCurvedEdge(...))` produces a 4-point orthogonal elbow — it
 * reads as a hard right angle. The reference design draws edges as smooth
 * curves, so this emits real `C` commands instead.
 *
 * Backward edges (target left of source) get a larger bend so the curve bulges
 * out rather than collapsing into a straight line through both nodes.
 *
 * @param {{ x: number, y: number, w: number, h: number, cy: number }} from
 * @param {{ x: number, y: number, w: number, h: number, cy: number }} to
 * @param {{ bendRatio?: number, minBend?: number, maxBend?: number }} [opts]
 * @returns {string}
 */
export function cubicEdgePath(from, to, opts = {}) {
  const bendRatio = opts.bendRatio || 0.5
  const minBend = opts.minBend || 28
  const maxBend = opts.maxBend || 120

  const x1 = from.x + from.w
  const y1 = from.cy
  const x2 = to.x
  const y2 = to.cy
  const span = x2 - x1
  const bend = Math.min(maxBend, Math.max(minBend, Math.abs(span) * bendRatio))
  const back = span < 0
  const c1 = back ? x1 + bend * 1.6 : x1 + bend
  const c2 = back ? x2 - bend * 1.6 : x2 - bend
  return `M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`
}

/**
 * Renders SVG <defs> containing arrow markers for standard, active, highlight,
 * watchpoint, read, write, and dimmed edge styles.
 *
 * @param {any} React
 * @returns {any}
 */
export function renderCommonSvgMarkers(React) {
  const el = React.createElement

  return el(
    'defs',
    null,
    // Default edge arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-default',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-border)' }),
    ),
    // Active (e.g. current call stack) arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-active',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-info)' }),
    ),
    // Highlighted edge arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-highlight',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-warning)' }),
    ),
    // Watchpoint hit / modified edge arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-watchpoint',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-brand)' }),
    ),
    // Data read edge arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-data-read',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-success)' }),
    ),
    // Data write edge arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-data-write',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-danger)' }),
    ),
    // Dimmed edge arrow
    el(
      'marker',
      {
        id: 'dvb-arrow-dim',
        viewBox: '0 0 10 10',
        refX: 8,
        refY: 5,
        markerWidth: 5,
        markerHeight: 5,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-color-fg-subtle)' }),
    ),
  )
}
