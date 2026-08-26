// @ts-nocheck
import { pointIdOf } from '../../../bench-points.mjs'

export const AREA_FN = { coil: 1, discreteInput: 2, holdingRegister: 3, inputRegister: 4 }

export const fnOfPoint = (p) => Number(p?.function) || AREA_FN[p?.area] || 3

export const findPointV3 = (points, fn, address, activeConnId, activeDevId) => {
  const list = Array.isArray(points) ? points : []
  let hit = list.find(
    (p) =>
      fnOfPoint(p) === Number(fn) &&
      Number(p.address) === Number(address) &&
      p.connectionId === activeConnId &&
      p.deviceId === activeDevId,
  )
  if (hit) return hit
  hit = list.find((p) => fnOfPoint(p) === Number(fn) && Number(p.address) === Number(address))
  if (hit) return hit
  const id = pointIdOf(fn, address)
  return list.find((p) => p.id === id) || null
}
