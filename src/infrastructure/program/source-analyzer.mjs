// @ts-check
// PARITY IMPLEMENTATION ONLY.
// Phase 7 replaces function/call/data extraction with a parser-backed analyzer.

import { MAX_FUNCS_FILE } from '../../domain/keil/project-model.mjs'

const INCLUDE_RE = /^[ \t]*#[ \t]*include[ \t]+[<"]([^>"]+)[>"]/gm

const FUNC_PROTO =
  /^[ \t]*(?:(?:static|inline|extern|__inline|__forceinline)\s+)*[\w*][\w\s*]+\s+(\w+)\s*\([^;{}]{0,240}\)\s*(\{)?\s*$/

const FUNC_SKIP = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'sizeof',
  'typeof',
  'catch',
  'else',
  'do',
  'case',
  'default',
  'defined',
])

const TYPE_KEYWORD_RE = /\b(typedef|struct|enum|union)\b/

/**
 * Extract C function definitions matching keil_project.py parity regex.
 * @param {string} text
 * @param {number} [maxFuncs]
 * @returns {Array<{ name: string, line: number }>}
 */
export function extractFunctions(text, maxFuncs = MAX_FUNCS_FILE) {
  const lines = text.split(/\r?\n/)
  /** @type {Array<{ name: string, line: number }>} */
  const out = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.trim()
    if (!stripped || stripped.startsWith('#') || TYPE_KEYWORD_RE.test(line)) {
      continue
    }
    const match = FUNC_PROTO.exec(line)
    if (!match) {
      continue
    }
    const name = match[1]
    if (FUNC_SKIP.has(name)) {
      continue
    }
    if (!match[2]) {
      // Find the next non-empty line within the next 2 lines
      let nxt = ''
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const candidate = lines[j].trim()
        if (candidate) {
          nxt = candidate
          break
        }
      }
      if (nxt !== '{') {
        continue
      }
    }
    out.push({ name, line: i + 1 })
    if (out.length >= maxFuncs) {
      break
    }
  }

  return out
}

/**
 * Extract include file paths from C source.
 * @param {string} text
 * @param {number} [maxIncludes]
 * @returns {string[]}
 */
export function extractIncludes(text, maxIncludes = 40) {
  /** @type {string[]} */
  const seen = []
  INCLUDE_RE.lastIndex = 0
  let match = INCLUDE_RE.exec(text)
  while (match !== null) {
    const name = match[1].trim().replaceAll('\\', '/')
    if (name && !seen.includes(name)) {
      seen.push(name)
      if (seen.length >= maxIncludes) break
    }
    match = INCLUDE_RE.exec(text)
  }
  return seen
}
