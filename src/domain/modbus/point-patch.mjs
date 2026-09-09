// @ts-check
import { AREA_BY_FN, FN_BY_AREA, VALID_AREAS } from './point-model.mjs'

const PATCHABLE = new Set([
  'name',
  'function',
  'area',
  'address',
  'scale',
  'offset',
  'unit',
  'monitorEnabled',
  'alarmEnabled',
  'alarmMin',
  'alarmMax',
])

const FROZEN = ['id', 'connectionId', 'deviceId']

/**
 * Apply an explicit field patch onto an existing point.
 * @param {any} existingPoint
 * @param {any} patch
 */
export function applyPointPatch(existingPoint, patch) {
  const existing = existingPoint && typeof existingPoint === 'object' ? existingPoint : null
  if (!existing || !existing.id) {
    return { ok: false, errorCode: 'POINT_NOT_FOUND', error: '点位不存在' }
  }
  const src = patch && typeof patch === 'object' ? patch : {}
  for (const key of FROZEN) {
    if (src[key] == null || src[key] === '') continue
    if (String(src[key]).trim() !== String(existing[key] || '').trim()) {
      return {
        ok: false,
        errorCode: 'TARGET_MISMATCH',
        error: `不得通过 update 修改 ${key}`,
      }
    }
  }
  const next = { ...existing }
  for (const key of PATCHABLE) {
    if (Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) {
      next[key] = src[key]
    }
  }
  if (src.function !== undefined) {
    const fn = Math.trunc(Number(src.function))
    if ([1, 2, 3, 4].includes(fn)) {
      next.function = fn
      next.area = AREA_BY_FN[fn]
    }
  } else if (src.area !== undefined && VALID_AREAS.has(src.area)) {
    next.area = src.area
    next.function = FN_BY_AREA[src.area]
  }
  if (src.monitorEnabled !== undefined) {
    next.monitorEnabled = src.monitorEnabled === true
    next.trendEnabled = next.monitorEnabled
  }
  if (src.alarmEnabled !== undefined) {
    next.alarmEnabled = src.alarmEnabled === true
  }
  if (src.trendEnabled !== undefined && src.monitorEnabled === undefined) {
    next.monitorEnabled = src.trendEnabled === true
    next.trendEnabled = src.trendEnabled === true
  }
  return { ok: true, point: next }
}
