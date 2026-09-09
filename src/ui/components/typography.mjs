/**
 * Typography System / Design Tokens
 * Centralized typography configuration and runtime adaptation module for DSH Vision Bench.
 * Provides unified font tokens, global scaling factors, and responsive typography helpers.
 */

export const TYPOGRAPHY_TOKENS = Object.freeze({
  fontSize: {
    xs: '11px',    // Micro badges, chips, code tags
    sm: '12px',    // Secondary hints, status labels, metadata
    base: '13px',  // Standard text, table cells, form inputs, pill/action buttons (matches Cancel/Save)
    md: '14px',    // Section headers, card titles, setting labels
    lg: '16px',    // Modal headers, drawer titles
    xl: '18px',    // Dialog main titles, hero banners
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.45,
    base: 1.5,
    relaxed: 1.6,
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  fontFamily: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  },
})

/**
 * Dynamically adjust the global font scale factor for the entire plugin.
 * A factor of 1.0 is default (base = 13px).
 * Setting to 1.1 increases base to 14.3px; 0.9 decreases base to 11.7px.
 *
 * @param {number} scaleFactor - Multiplier, e.g. 1.0, 1.1, 1.2
 * @param {HTMLElement} [targetEl] - Root element (defaults to body or document element)
 */
export function setGlobalFontScale(scaleFactor = 1.0, targetEl = null) {
  const el = targetEl || (typeof document !== 'undefined' ? document.body : null)
  if (!el || typeof el.style?.setProperty !== 'function') return
  const safeScale = Math.max(0.75, Math.min(2.0, Number(scaleFactor) || 1.0))
  el.style.setProperty('--dvb-font-scale', String(safeScale))
}

/**
 * Get the current font scale factor from the root element.
 * @param {HTMLElement} [targetEl]
 * @returns {number}
 */
export function getGlobalFontScale(targetEl = null) {
  const el = targetEl || (typeof document !== 'undefined' ? document.body : null)
  if (!el || typeof getComputedStyle !== 'function') return 1.0
  const val = getComputedStyle(el).getPropertyValue('--dvb-font-scale').trim()
  return Number.parseFloat(val) || 1.0
}

/**
 * Renders a standardized typography element.
 *
 * @param {Function} el - React.createElement or hyperscript factory
 * @param {string} text - Text content
 * @param {Object} [props] - Options (variant, weight, mono, className, style, etc.)
 */
export function renderText(el, text, props = {}) {
  const {
    tag = 'span',
    variant = 'base', // 'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl'
    weight = 'regular', // 'regular' | 'medium' | 'semibold' | 'bold'
    mono = false,
    color,
    opacity,
    className = '',
    style = {},
    ...rest
  } = props

  const classes = [
    `dvb-text-${variant}`,
    weight !== 'regular' ? `dvb-font-${weight}` : '',
    mono ? 'dvb-text-mono' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const inlineStyle = {
    ...style,
    ...(color ? { color } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
  }

  return el(tag, { className: classes, style: inlineStyle, ...rest }, text)
}

/**
 * Renders a standardized heading element.
 *
 * @param {Function} el - React.createElement or hyperscript factory
 * @param {string} text - Title text
 * @param {Object} [props] - Options (level, className, style, etc.)
 */
export function renderHeading(el, text, props = {}) {
  const { level = 2, className = '', ...rest } = props
  const tag = `h${Math.max(1, Math.min(6, level))}`
  const variant = level <= 1 ? 'xl' : level === 2 ? 'lg' : level === 3 ? 'md' : 'base'
  return renderText(el, text, {
    tag,
    variant,
    weight: 'semibold',
    className: `dvb-heading ${className}`.trim(),
    ...rest,
  })
}

export function createTypography(React) {
  const el = React.createElement
  return {
    Text(props) {
      const { children, ...rest } = props
      return renderText(el, children, rest)
    },
    Heading(props) {
      const { children, ...rest } = props
      return renderHeading(el, children, rest)
    },
    TOKENS: TYPOGRAPHY_TOKENS,
    setScale: setGlobalFontScale,
    getScale: getGlobalFontScale,
  }
}
