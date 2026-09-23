import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const UI_ROOT = fileURLToPath(new URL('../../src/ui/', import.meta.url))
const CJK = /[\u3400-\u9fff]/

/** Ratchet: lower this when strings move into src/ui/i18n. Do not raise it. */
const CJK_LITERAL_BASELINE = 878

/**
 * @param {string} source
 */
function countCjkStringLiterals(source) {
  let count = 0
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      const next = source.indexOf('\n', i)
      i = next < 0 ? source.length : next
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let j = i + 1
      let body = ''
      while (j < source.length) {
        if (source[j] === '\\') {
          body += source[j + 1] || ''
          j += 2
          continue
        }
        if (quote === '`' && source[j] === '$' && source[j + 1] === '{') {
          j += 2
          let depth = 1
          while (j < source.length && depth) {
            if (source[j] === '{') depth += 1
            else if (source[j] === '}') depth -= 1
            j += 1
          }
          continue
        }
        if (source[j] === quote) break
        body += source[j]
        j += 1
      }
      if (CJK.test(body)) count += 1
      i = j + 1
      continue
    }
    i += 1
  }
  return count
}

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function listUiSources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'i18n') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) listUiSources(full, acc)
    else if (name.endsWith('.mjs')) acc.push(full)
  }
  return acc
}

function countUiCjkLiterals(root = UI_ROOT) {
  return listUiSources(root).reduce((sum, file) => sum + countCjkStringLiterals(readFileSync(file, 'utf8')), 0)
}

test('countCjkStringLiterals ignores comments and counts quoted CJK', () => {
  const sample = "const a = '中文'\n// 注释\nconst b = \"english\"\nconst c = `模板${'文'}`\n"
  assert.equal(countCjkStringLiterals(sample), 2)
})

test('src/ui CJK string literals outside i18n stay at or under the ratchet', () => {
  const count = countUiCjkLiterals()
  assert.ok(
    count <= CJK_LITERAL_BASELINE,
    `CJK string literals in src/ui (excluding i18n) is ${count}; baseline is ${CJK_LITERAL_BASELINE}. Move copy into src/ui/i18n and lower the baseline.`,
  )
})
