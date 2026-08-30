// @ts-check
const PATCHABLE = new Set([
  'name',
  'function',
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
  if (src.trendEnabled !== undefined && src.monitorEnabled === undefined) {
    next.monitorEnabled = src.trendEnabled === true
  }
  return { ok: true, point: next }
}
