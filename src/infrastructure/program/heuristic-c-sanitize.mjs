// @ts-check

/**
 * Strips comments and string literals from C source while preserving original line numbers.
 * Comments and string contents are replaced with spaces/newlines.
 *
 * @param {string} source
 * @returns {string} Cleaned source with identical line count and positions
 */
export function sanitizeCSource(source) {
  const chars = source.split('')
  const len = chars.length
  let i = 0

  while (i < len) {
    const ch = chars[i]
    const next = i + 1 < len ? chars[i + 1] : ''

    // Line comment: // ...
    if (ch === '/' && next === '/') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 2
      while (i < len && chars[i] !== '\n') {
        chars[i] = ' '
        i++
      }
      continue
    }

    // Block comment: /* ... */
    if (ch === '/' && next === '*') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 2
      while (i < len) {
        if (chars[i] === '*' && i + 1 < len && chars[i + 1] === '/') {
          chars[i] = ' '
          chars[i + 1] = ' '
          i += 2
          break
        }
        if (chars[i] !== '\n') {
          chars[i] = ' '
        }
        i++
      }
      continue
    }

    // String literal: "..."
    if (ch === '"') {
      chars[i] = ' '
      i++
      while (i < len && chars[i] !== '"') {
        if (chars[i] === '\\' && i + 1 < len) {
          chars[i] = ' '
          i++
          if (chars[i] !== '\n') chars[i] = ' '
        } else if (chars[i] !== '\n') {
          chars[i] = ' '
        }
        i++
      }
      if (i < len && chars[i] === '"') {
        chars[i] = ' '
        i++
      }
      continue
    }

    // Char literal: '...'
    if (ch === "'") {
      chars[i] = ' '
      i++
      while (i < len && chars[i] !== "'") {
        if (chars[i] === '\\' && i + 1 < len) {
          chars[i] = ' '
          i++
          if (chars[i] !== '\n') chars[i] = ' '
        } else if (chars[i] !== '\n') {
          chars[i] = ' '
        }
        i++
      }
      if (i < len && chars[i] === "'") {
        chars[i] = ' '
        i++
      }
      continue
    }

    i++
  }

  return chars.join('')
}
