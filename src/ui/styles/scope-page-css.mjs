import { ATTR } from './base-attr.mjs'

const PAGE = `body[${ATTR}]`

/**
 * Ensure every style rule is under `body[data-dsh-vision-bench]`.
 * Prefer selector prefixing over CSS-nesting wrap (`body[ATTR]{ … }`): nesting
 * made whole sidebar/alarm sheets fail to apply in Desktop, which looked like
 * “styles disappeared” (stacked filters, flat pills, bare tables).
 */
export function scopePageCss(css) {
  let text = String(css || '').trim()
  if (!text) return text

  // Unwrap legacy nest form produced by older scopePageCss.
  if (text.startsWith(`${PAGE}{`) && text.endsWith('}')) {
    let depth = 0
    let end = -1
    for (let i = PAGE.length; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === text.length - 1) text = text.slice(PAGE.length + 1, end).trim()
  }

  return prefixUnscopedSelectors(text, `${PAGE} `)
}

function splitSelectorList(selector) {
  const out = []
  let buf = ''
  let depth = 0
  for (const ch of selector) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function prefixUnscopedSelectors(css, prefix) {
  let i = 0
  let out = ''

  function walk(scoped) {
    let buf = ''
    while (i < css.length) {
      const ch = css[i]
      if (ch === '{') {
        const sel = buf.trim()
        buf = ''
        i += 1
        if (/^@(-webkit-)?keyframes\b/.test(sel)) {
          out += `${sel}{`
          walk(true)
          continue
        }
        if (/^@(media|supports|layer|container)\b/.test(sel) || sel.startsWith('@')) {
          out += `${sel}{`
          walk(scoped)
          continue
        }
        const parts = splitSelectorList(sel)
        const selfScoped = parts.length > 0 && parts.every((part) => part.includes(ATTR))
        const next = scoped || selfScoped
        const rewritten = parts
          .map((part) => {
            if (next || part.includes(ATTR)) return part
            // Document-level hooks (e.g. body.dvb-resizing-col) must stay on <body>,
            // not become body[ATTR] body.….
            if (/^(html|body)([.#[:\s>]|$)/.test(part)) return part
            return `${prefix}${part}`
          })
          .join(',')
        out += `${rewritten}{`
        // Declarations (or nested rules) until the matching `}`.
        walk(true)
        continue
      }
      if (ch === '}') {
        // Flush property text accumulated since the last `{` / `}`.
        out += buf
        buf = ''
        out += '}'
        i += 1
        return
      }
      buf += ch
      i += 1
    }
    out += buf
  }

  walk(false)
  return out
}
