// @ts-check
/**
 * DSH Agent tool output must be lossless JSON: plain JSON types only.
 * `undefined` own properties, NaN/Infinity, class instances, AbortSignal, and
 * circular structures fail the harness projector with "value is not lossless JSON".
 * HTTP already round-trips through JSON.stringify; in-process dispatch must too.
 */

const HOST_INVALID_RESPONSE = 'HOST_INVALID_RESPONSE'

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLosslessJsonValue(value) {
  if (value === null) return true
  const kind = typeof value
  if (kind === 'boolean' || kind === 'string') return true
  if (kind === 'number') return Number.isFinite(value)
  if (kind !== 'object' || value === null) return false
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) return false
      if (!isLosslessJsonValue(value[i])) return false
    }
    return true
  }
  const obj = /** @type {Record<string, unknown>} */ (value)
  const proto = Object.getPrototypeOf(obj)
  if (proto !== Object.prototype && proto !== null) return false
  for (const key of Object.keys(obj)) {
    if (!isLosslessJsonValue(obj[key])) return false
  }
  return true
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isAbortSignal(value) {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal
}

/**
 * @param {string} _key
 * @param {unknown} value
 * @returns {unknown}
 */
function losslessReplacer(_key, value) {
  if (value === undefined) return undefined
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  if (isAbortSignal(value)) return undefined
  if (value instanceof Error) {
    return { name: value.name, message: String(value.message || '') }
  }
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Set) return [...value]
  return value
}

/**
 * JSON round-trip that matches HTTP `JSON.stringify` plus replacements for
 * values stringify would throw on or silently turn into `{}`.
 * @param {unknown} value
 * @returns {unknown}
 */
export function toLosslessJson(value) {
  try {
    const text = JSON.stringify(value, losslessReplacer)
    if (typeof text !== 'string') return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Command/tool results must be JSON objects. Unserializable input fails closed.
 * @param {unknown} result
 * @returns {Record<string, unknown>}
 */
export function losslessCommandResult(result) {
  const cleaned = toLosslessJson(result)
  if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)) {
    return /** @type {Record<string, unknown>} */ (cleaned)
  }
  return {
    ok: false,
    errorCode: HOST_INVALID_RESPONSE,
    error: '命令结果不是 lossless JSON',
  }
}
