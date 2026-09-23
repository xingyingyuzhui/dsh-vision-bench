import assert from 'node:assert/strict'
import test from 'node:test'
import { ATTR, scopePageCss } from '../../src/ui/styles/base.mjs'
import { RUNTIME_CSS } from '../../src/ui/styles/runtime.mjs'
import { SIDEBAR_CSS } from '../../src/ui/styles/sidebar.mjs'

function splitSelectors(selector) {
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

function unscopedSelectors(css) {
  const text = String(css || '')
  const found = []
  let i = 0

  function parse(scoped) {
    let buf = ''
    while (i < text.length) {
      const ch = text[i]
      if (ch === '{') {
        const sel = buf.trim()
        buf = ''
        i += 1
        if (/^@(-webkit-)?keyframes\b/.test(sel)) {
          parse(true)
        } else if (/^@(media|supports|layer|container)\b/.test(sel) || sel.startsWith('@')) {
          parse(scoped)
        } else {
          const parts = splitSelectors(sel)
          const selfScoped = parts.length > 0 && parts.every((part) => part.includes(ATTR))
          const next = scoped || selfScoped
          if (!next) {
            for (const part of parts) {
              if (!part.includes(ATTR)) found.push(part)
            }
          }
          parse(next)
        }
        continue
      }
      if (ch === '}') {
        i += 1
        return
      }
      buf += ch
      i += 1
    }
  }

  parse(false)
  return found
}

test('unscopedSelectors flags a bare class and ignores a page-prefixed rule', () => {
  assert.deepEqual(unscopedSelectors('.dvb-pill{color:red}'), ['.dvb-pill'])
  assert.deepEqual(unscopedSelectors('body[data-dsh-vision-bench] .dvb-pill{color:red}'), [])
  assert.deepEqual(unscopedSelectors('body[data-dsh-vision-bench]{.dvb-pill{color:red}}'), [])
})

test('sidebar and runtime style strings have no unscoped selectors', () => {
  for (const block of [...SIDEBAR_CSS, ...RUNTIME_CSS]) {
    assert.deepEqual(unscopedSelectors(block), [])
    assert.equal(scopePageCss(block), block.trim())
  }
  assert.match(SIDEBAR_CSS.join('\n'), /--dvb-color-info/)
  assert.doesNotMatch(SIDEBAR_CSS.join('\n'), /#1d4ed8|#6d28d9|#059669/)
})
