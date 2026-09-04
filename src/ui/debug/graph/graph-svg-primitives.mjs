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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-border-subtle, #3b4252)' }),
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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-accent-cyan, #58a6ff)' }),
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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-accent-gold, #e3b341)' }),
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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-accent-purple, #bc8cff)' }),
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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-accent-green, #3fb950)' }),
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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'var(--dvb-accent-red, #f85149)' }),
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
      el('path', { d: 'M 0 1.5 L 8 5 L 0 8.5 z', fill: 'rgba(255, 255, 255, 0.12)' }),
    ),
  )
}
