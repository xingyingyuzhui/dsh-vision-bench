// @ts-check
import { AREA_BY_FN, FN_BY_AREA, VALID_AREAS, parseAlarmDeadband } from './point-model.mjs'
import { ERROR_CODES } from './errors.mjs'

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
  'alarmDeadband',
])

const FROZEN = ['id', 'connectionId', 'deviceId']

/**
 * Validate monitorEnabled / trendEnabled alias pair before normalize or patch.
 * Same request with opposite boolean semantics → FIELD_CONFLICT.
 * @param {any} input
 * @returns {{ ok: true, hasMonitor: boolean, hasTrendAlias: boolean } | { ok: false, errorCode: string, error: string }}
 */
export function validateMonitorAlias(input) {
  const src = input && typeof input === 'object' ? input : {}
  const hasMonitor =
    Object.prototype.hasOwnProperty.call(src, 'monitorEnabled') && src.monitorEnabled !== undefined
  const hasTrendAlias =
    Object.prototype.hasOwnProperty.call(src, 'trendEnabled') && src.trendEnabled !== undefined
  if (hasMonitor && hasTrendAlias) {
    const mon = src.monitorEnabled === true
    const trend = src.trendEnabled === true
    if (mon !== trend) {
      return {
        ok: false,
        errorCode: ERROR_CODES.FIELD_CONFLICT,
        error: 'monitorEnabled 与 trendEnabled 冲突：二者为同一开关，不可在同一次请求中传相反值',
      }
    }
  }
  return { ok: true, hasMonitor, hasTrendAlias }
}

/**
 * Apply an explicit field patch onto an existing point.
 * `trendEnabled` remains a legacy single-field alias of `monitorEnabled`.
 * Same request with conflicting monitorEnabled vs trendEnabled → FIELD_CONFLICT.
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

  const alias = validateMonitorAlias(src)
  if (!alias.ok) return alias
  /** @type {number | null | undefined} */
  let deadband
  const hasDeadband = Object.prototype.hasOwnProperty.call(src, 'alarmDeadband') && src.alarmDeadband !== undefined
  if (hasDeadband) {
    const parsed = parseAlarmDeadband(src.alarmDeadband)
    if (!parsed.ok) {
      return {
        ok: false,
        errorCode: ERROR_CODES.INVALID_FIELD,
        error: 'alarmDeadband 必须是非负有限数或空',
      }
    }
    deadband = parsed.value
  }
  const hasMonitor = alias.hasMonitor
  const hasTrendAlias = alias.hasTrendAlias

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
  if (hasMonitor) {
    next.monitorEnabled = src.monitorEnabled === true
    next.trendEnabled = next.monitorEnabled
  } else if (hasTrendAlias) {
    // Legacy single-field alias
    next.monitorEnabled = src.trendEnabled === true
    next.trendEnabled = src.trendEnabled === true
  }
  if (src.alarmEnabled !== undefined) {
    next.alarmEnabled = src.alarmEnabled === true
  }
  if (hasDeadband) next.alarmDeadband = deadband
  // Always mirror legacy field for UI compatibility
  if (next.monitorEnabled !== undefined) {
    next.trendEnabled = next.monitorEnabled === true
  }
  return { ok: true, point: next }
}
