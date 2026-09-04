// @ts-check
import { MIRecord } from './mi-record.mjs'

/**
 * Parses C-style escaped string starting at pos.
 * @param {string} str
 * @param {number} start
 * @returns {{ value: string, nextPos: number }}
 */
export function parseCString(str, start) {
  if (str[start] !== '"') {
    return { value: '', nextPos: start }
  }
  let out = ''
  let i = start + 1
  while (i < str.length) {
    const ch = str[i]
    if (ch === '"') {
      return { value: out, nextPos: i + 1 }
    }
    if (ch === '\\') {
      i++
      if (i >= str.length) break
      const esc = str[i]
      if (esc === 'n') out += '\n'
      else if (esc === 'r') out += '\r'
      else if (esc === 't') out += '\t'
      else if (esc === '\\') out += '\\'
      else if (esc === '"') out += '"'
      else if (esc === 'f') out += '\f'
      else if (esc === 'b') out += '\b'
      else if (/[0-7]/.test(esc)) {
        // Octal escape \ooo
        let octal = esc
        if (i + 1 < str.length && /[0-7]/.test(str[i + 1])) {
          octal += str[++i]
          if (i + 1 < str.length && /[0-7]/.test(str[i + 1])) {
            octal += str[++i]
          }
        }
        out += String.fromCharCode(Number.parseInt(octal, 8))
      } else {
        out += esc
      }
    } else {
      out += ch
    }
    i++
  }
  return { value: out, nextPos: i }
}

/**
 * Parses a value (const, tuple, list, or word) starting at pos.
 * @param {string} str
 * @param {number} startPos
 * @returns {{ value: any, nextPos: number }}
 */
export function parseValue(str, startPos) {
  let pos = startPos
  while (pos < str.length && /\s/.test(str[pos])) pos++
  if (pos >= str.length) return { value: '', nextPos: pos }

  const ch = str[pos]
  if (ch === '"') {
    return parseCString(str, pos)
  }
  if (ch === '{') {
    return parseTuple(str, pos)
  }
  if (ch === '[') {
    return parseList(str, pos)
  }

  // Raw unquoted token
  let end = pos
  while (end < str.length && !/[,\]\}\s]/.test(str[end])) {
    end++
  }
  return { value: str.slice(pos, end), nextPos: end }
}

/**
 * Parses a tuple { key=value, key=value, ... } starting at pos.
 * @param {string} str
 * @param {number} start
 * @returns {{ value: Record<string, any>, nextPos: number }}
 */
export function parseTuple(str, start) {
  let pos = start + 1
  /** @type {Record<string, any>} */
  const tuple = {}

  while (pos < str.length) {
    while (pos < str.length && /[\s,]/.test(str[pos])) pos++
    if (pos >= str.length || str[pos] === '}') {
      return { value: tuple, nextPos: pos + 1 }
    }

    // variable name
    let eqPos = pos
    while (eqPos < str.length && str[eqPos] !== '=' && str[eqPos] !== '}') {
      eqPos++
    }
    if (eqPos >= str.length || str[eqPos] === '}') {
      return { value: tuple, nextPos: eqPos + 1 }
    }

    const key = str.slice(pos, eqPos).trim()
    pos = eqPos + 1 // skip =

    const valResult = parseValue(str, pos)
    if (key) {
      tuple[key] = valResult.value
    }
    pos = valResult.nextPos
  }

  return { value: tuple, nextPos: pos }
}

/**
 * Parses a list [ ... ] starting at pos.
 * GDB lists can be list of values [1, 2] or list of results [name="a", name="b"].
 * @param {string} str
 * @param {number} start
 * @returns {{ value: any[], nextPos: number }}
 */
export function parseList(str, start) {
  let pos = start + 1
  /** @type {any[]} */
  const list = []

  while (pos < str.length) {
    while (pos < str.length && /[\s,]/.test(str[pos])) pos++
    if (pos >= str.length || str[pos] === ']') {
      return { value: list, nextPos: pos + 1 }
    }

    // Check if element is a named result: var=val
    let probe = pos
    while (probe < str.length && !/[=\[\{",\]\s]/.test(str[probe])) {
      probe++
    }

    if (probe < str.length && str[probe] === '=') {
      const key = str.slice(pos, probe).trim()
      pos = probe + 1
      const valResult = parseValue(str, pos)
      list.push({ [key]: valResult.value })
      pos = valResult.nextPos
    } else {
      const valResult = parseValue(str, pos)
      list.push(valResult.value)
      pos = valResult.nextPos
    }
  }

  return { value: list, nextPos: pos }
}

/**
 * Parses comma-separated results starting at pos.
 * @param {string} str
 * @param {number} start
 * @returns {Record<string, any>}
 */
export function parseResults(str, start) {
  let pos = start
  /** @type {Record<string, any>} */
  const results = {}

  while (pos < str.length) {
    while (pos < str.length && /[\s,]/.test(str[pos])) pos++
    if (pos >= str.length) break

    let eqPos = pos
    while (eqPos < str.length && str[eqPos] !== '=') {
      eqPos++
    }
    if (eqPos >= str.length) break

    const key = str.slice(pos, eqPos).trim()
    pos = eqPos + 1

    const valResult = parseValue(str, pos)
    if (key) {
      results[key] = valResult.value
    }
    pos = valResult.nextPos
  }

  return results
}

/**
 * Parses a single line of GDB/MI output into a MIRecord.
 *
 * @param {string} rawLine
 * @returns {MIRecord | null}
 */
export function parseMILine(rawLine) {
  const line = String(rawLine || '').trim()
  if (!line) return null

  if (line === '(gdb)' || line.startsWith('(gdb)')) {
    return new MIRecord({ kind: 'prompt' })
  }

  let pos = 0
  let token = null

  // Optional token
  const tokenMatch = /^\d+/.exec(line)
  if (tokenMatch) {
    token = Number.parseInt(tokenMatch[0], 10)
    pos = tokenMatch[0].length
  }

  if (pos >= line.length) return null

  const prefix = line[pos]
  pos++

  // Stream records
  if (prefix === '~') {
    const { value } = parseCString(line, pos)
    return new MIRecord({ token, kind: 'console-stream', text: value })
  }
  if (prefix === '@') {
    const { value } = parseCString(line, pos)
    return new MIRecord({ token, kind: 'target-stream', text: value })
  }
  if (prefix === '&') {
    const { value } = parseCString(line, pos)
    return new MIRecord({ token, kind: 'log-stream', text: value })
  }

  // Result and Async records
  let kind = null
  if (prefix === '^') kind = 'result'
  else if (prefix === '*') kind = 'exec-async'
  else if (prefix === '+') kind = 'status-async'
  else if (prefix === '=') kind = 'notify-async'

  if (!kind) {
    return null
  }

  // Parse class name until comma or end
  let classEnd = pos
  while (classEnd < line.length && line[classEnd] !== ',') {
    classEnd++
  }
  const className = line.slice(pos, classEnd).trim()
  pos = classEnd

  const results = pos < line.length ? parseResults(line, pos) : {}

  return new MIRecord({
    token,
    kind: /** @type {any} */ (kind),
    class: className,
    results,
  })
}
