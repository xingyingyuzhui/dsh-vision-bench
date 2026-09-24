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
import { normalizePointGetSelector } from '../../domain/modbus/point-get-selector.mjs'
import { claimLegacyPrivate } from './config-scope-service.mjs'
import { claimWorkspaceSync, modbusForSession } from './workspace-session-view.mjs'

export {
  POINTS_GET_MAX_IDS,
  isKnownPointsOp,
  normalizePointGetSelector,
  unknownPointsOpResult,
} from '../../domain/modbus/point-get-selector.mjs'

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
