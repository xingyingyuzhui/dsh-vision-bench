// @ts-check
/**
 * Pure selector normalization for points op=get (Agent preflight + Host query).
 * No workspace / store / I/O imports — keep Agent tool dependency closure disk-free.
 */
import { ERROR_CODES } from './errors.mjs'

export const POINTS_GET_MAX_IDS = 32

const POINT_OPS = new Set(['list', 'get', 'add', 'update', 'remove', 'clear'])

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function collectRawIds(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  return [value]
}

/**
 * Normalize ids / pointId / id selectors for points get.
 * Multiple selector fields must agree after normalization.
 *
 * @param {any} query
 * @returns {{
 *   ok: true,
 *   ids: string[],
 *   connectionId: string,
 *   deviceId: string,
 * } | {
 *   ok: false,
 *   errorCode: string,
 *   error: string,
 *   missingFields?: string[],
 *   hint?: string,
 * }}
 */
export function normalizePointGetSelector(query) {
  const sources = []
  if (Object.prototype.hasOwnProperty.call(query || {}, 'ids')) {
    sources.push({ field: 'ids', values: collectRawIds(query.ids) })
  }
  if (Object.prototype.hasOwnProperty.call(query || {}, 'pointId')) {
    sources.push({ field: 'pointId', values: collectRawIds(query.pointId) })
  }
  if (Object.prototype.hasOwnProperty.call(query || {}, 'id')) {
    sources.push({ field: 'id', values: collectRawIds(query.id) })
  }

  if (!sources.length) {
    return {
      ok: false,
      errorCode: ERROR_CODES.TARGET_REQUIRED,
      error: '缺少必要参数: ids',
      missingFields: ['ids'],
      hint: 'points op=get 使用 ids[]（批量，最多 32）或 pointId/id（单点）',
    }
  }

  /** @type {string[][]} */
  const normalizedSets = []
  for (const src of sources) {
    /** @type {string[]} */
    const ordered = []
    const seen = new Set()
    for (const raw of src.values) {
      if (typeof raw !== 'string') {
        return {
          ok: false,
          errorCode: ERROR_CODES.INVALID_FIELD,
          error: `${src.field} 必须是字符串或字符串数组`,
          missingFields: [src.field],
          hint: 'ids/pointId/id 只接受非空字符串',
        }
      }
      const id = raw.trim()
      if (!id) continue
      if (seen.has(id)) continue
      seen.add(id)
      ordered.push(id)
    }
    normalizedSets.push(ordered)
  }

  const primary = normalizedSets[0]
  const primarySet = new Set(primary)
  for (let i = 1; i < normalizedSets.length; i += 1) {
    const other = normalizedSets[i]
    const otherSet = new Set(other)
    if (primarySet.size !== otherSet.size || [...primarySet].some((id) => !otherSet.has(id))) {
      return {
        ok: false,
        errorCode: ERROR_CODES.FIELD_CONFLICT,
        error: 'ids / pointId / id 选择器不一致',
        missingFields: sources.map((s) => s.field),
        hint: '多个选择字段同时出现时，规范化后的 ID 集合必须相同',
      }
    }
  }

  if (!primary.length) {
    return {
      ok: false,
      errorCode: ERROR_CODES.TARGET_REQUIRED,
      error: '缺少必要参数: ids',
      missingFields: ['ids'],
      hint: 'points op=get 需要至少一个非空点位 ID',
    }
  }

  if (primary.length > POINTS_GET_MAX_IDS) {
    return {
      ok: false,
      errorCode: ERROR_CODES.INVALID_FIELD,
      error: `一次最多查询 ${POINTS_GET_MAX_IDS} 个点位 ID`,
      missingFields: ['ids'],
      hint: `将 ids 拆成不超过 ${POINTS_GET_MAX_IDS} 的批次后重试`,
    }
  }

  const connectionId =
    typeof query?.connectionId === 'string' && query.connectionId.trim()
      ? query.connectionId.trim()
      : typeof query?.connId === 'string' && query.connId.trim()
        ? query.connId.trim()
        : ''
  const deviceId =
    typeof query?.deviceId === 'string' && query.deviceId.trim() ? query.deviceId.trim() : ''

  return { ok: true, ids: primary, connectionId, deviceId }
}

/**
 * @param {string} op
 * @returns {boolean}
 */
export function isKnownPointsOp(op) {
  return POINT_OPS.has(op)
}

/**
 * @returns {{ ok: false, errorCode: string, error: string, hint: string }}
 */
export function unknownPointsOpResult() {
  return {
    ok: false,
    errorCode: 'UNKNOWN_OP',
    error: 'points op 必须是 list | get | add | update | remove | clear',
    hint: '只读查询用 op=get + ids[]（最多 32）；list 不分页；修改用 add|update|remove|clear 并带 expectedConfigVersion',
  }
}
