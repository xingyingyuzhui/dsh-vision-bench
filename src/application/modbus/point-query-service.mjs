// @ts-check
/**
 * Read-only point lookup by id (points op=get).
 * Does not claim, migrate, mutate configVersion, or touch device I/O.
 */
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { compactPointRow } from '../../domain/modbus/point-value.mjs'
import { claimLegacyPrivate } from './config-scope-service.mjs'
import { claimWorkspaceSync, modbusForSession } from './workspace-session-view.mjs'

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
 * @param {string} home
 * @param {string} cwd
 * @param {any} query
 */
export async function getPoints(home, cwd, query) {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }

  const selector = normalizePointGetSelector(query)
  if (!selector.ok) {
    return {
      ok: false,
      action: 'points',
      errorCode: selector.errorCode,
      error: selector.error,
      missingFields: selector.missingFields,
      hint: selector.hint,
    }
  }

  const sessionId = typeof query?.sessionId === 'string' ? query.sessionId : ''
  const workspace = loadWorkspace(home, room.cwd)
  if (isScopePartitioned(workspace.modbus) && !String(sessionId || '').trim()) {
    return {
      ok: false,
      action: 'points',
      errorCode: ERROR_CODES.SESSION_REQUIRED,
      error: '该工作区已按会话隔离，points get 必须携带 sessionId',
    }
  }

  // In-memory claim for unpartitioned legacy views — never persisted.
  let viewSource = workspace
  if (sessionId && claimLegacyPrivate(workspace.modbus, sessionId).claimed) {
    viewSource = claimWorkspaceSync(workspace, sessionId).workspace
  }
  const pack = modbusForSession(viewSource, sessionId)
  let visible = Array.isArray(pack.points) ? /** @type {any[]} */ (pack.points) : []
  if (selector.connectionId) {
    visible = visible.filter((/** @type {any} */ p) => (p.connectionId || p.connId) === selector.connectionId)
  }
  if (selector.deviceId) {
    visible = visible.filter((/** @type {any} */ p) => p.deviceId === selector.deviceId)
  }

  const byId = new Map(visible.map((/** @type {any} */ p) => [p.id, p]))
  /** @type {any[]} */
  const found = []
  /** @type {string[]} */
  const missingIds = []
  for (const id of selector.ids) {
    const hit = byId.get(id)
    if (hit) found.push(compactPointRow(hit, pack.values))
    else missingIds.push(id)
  }

  const configVersion = pack.configVersion || 1
  const requested = selector.ids.length
  const returned = found.length

  if (returned === 0) {
    return {
      ok: false,
      action: 'points',
      errorCode: ERROR_CODES.POINT_NOT_FOUND,
      error: '点位不存在',
      configVersion,
      points: [],
      requested,
      returned: 0,
      missingIds,
    }
  }

  return {
    ok: true,
    action: 'points',
    configVersion,
    points: found,
    requested,
    returned,
    missingIds,
    partial: missingIds.length > 0,
  }
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
