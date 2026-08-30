// @ts-check
const WRITE_FNS = new Set([1, 3])

/** @param {unknown} fn @param {unknown} address */
export function pointIdOf(fn, address) {
  return `p${Number(fn)}_${Number(address)}`
}

/** @param {unknown} fn */
export function isWritableFunction(fn) {
  return WRITE_FNS.has(Number(fn))
}

/** @param {any} point @param {unknown} raw */
export function decodeValue(point, raw) {
  if (raw === null || raw === undefined || raw === '') return raw
  if (typeof raw === 'boolean') return raw
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const scale = Number(point?.scale)
  const offset = Number(point?.offset)
  return n * (Number.isFinite(scale) ? scale : 1) + (Number.isFinite(offset) ? offset : 0)
}
