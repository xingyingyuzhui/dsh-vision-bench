// @ts-check
import { pointIdOf } from './point-math.mjs'

export const AREA_FN = { coil: 1, discreteInput: 2, holdingRegister: 3, inputRegister: 4 }

/**
 * @param {any} p
 * @returns {any}
 */
export const fnOfPoint = (p) => {
  const fn = Number(p?.function)
  if (fn) return fn
  const area = typeof p?.area === 'string' ? p.area : ''
  if (area === 'coil' || area === 'discreteInput' || area === 'holdingRegister' || area === 'inputRegister') {
    return AREA_FN[/** @type {keyof typeof AREA_FN} */ (area)]
  }
  return 3
}

/**
 * @param {any} points
 * @param {any} fn
 * @param {any} address
 * @param {any} activeConnId
 * @param {any} activeDevId
 * @returns {any}
 */
export const findPointV3 = (points, fn, address, activeConnId, activeDevId) => {
  const list = Array.isArray(points) ? points : []
  let hit = list.find(
    (/** @type {any} */ p) =>
      fnOfPoint(p) === Number(fn) &&
      Number(p.address) === Number(address) &&
      p.connectionId === activeConnId &&
      p.deviceId === activeDevId,
  )
  if (hit) return hit
  hit = list.find((/** @type {any} */ p) => fnOfPoint(p) === Number(fn) && Number(p.address) === Number(address))
  if (hit) return hit
  const id = pointIdOf(fn, address)
  return list.find((/** @type {any} */ p) => p.id === id) || null
}
