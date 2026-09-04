// @ts-check
/**
 * Session-scoped runtime view of the layered workspace.
 *
 * `config-scope-service.mjs` holds the pure layer algebra (claim / project / fold).
 * This module is the thin persistence-aware seam that runtime services use so they
 * never operate on the empty flat layer after a workspace has been partitioned:
 *
 *   ensureWorkspaceClaimed → modbusForSession → (operate on flat view)
 */
import { normalizeModbus } from '../../../bench-devices.mjs'
import { applyWorkspacePatch, loadWorkspace, saveWorkspace, workspaceRepository } from '../../../bench-store.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isScopePartitioned, normalizeScopeSessionId, omitSessionConfigs } from '../../domain/modbus/config-scope.mjs'
import { claimLegacyPrivate, foldModbusFromSession, projectModbusForSession } from './config-scope-service.mjs'

const TOPOLOGY_KEYS = new Set([
  'connections',
  'devices',
  'points',
  'visualization',
  'activeConnectionId',
  'activeDeviceId',
  'share',
  'sessionConfigs',
  'privateClaimSessionId',
])

/**
 * @param {any} input
 * @returns {boolean}
 */
function patchTouchesTopology(input) {
  const mb = input && typeof input === 'object' ? input.modbus : null
  if (!mb || typeof mb !== 'object') return false
  return Object.keys(mb).some((key) => TOPOLOGY_KEYS.has(key))
}

/**
 * Load the layered workspace and, when a session is present, let it claim a legacy
 * flat topology as its private config. The claim is persisted once (lock-safe) and
 * does NOT bump configVersion.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {string | undefined} sessionId
 * @returns {Promise<any>} layered workspace (never a projection)
 */
export async function ensureWorkspaceClaimed(home, cwd, sessionId) {
  const sid = normalizeScopeSessionId(sessionId)
  const workspace = loadWorkspace(home, cwd)
  if (!sid || !claimLegacyPrivate(workspace.modbus, sid).claimed) return workspace
  const saved = await workspaceRepository(home).update(cwd, null, async (/** @type {any} */ current) => {
    const claimed = claimLegacyPrivate(current.modbus, sid)
    if (!claimed.claimed) return { ok: false, errorCode: 'CLAIM_RACE', error: 'workspace already claimed' }
    return { ok: true, workspace: { ...current, modbus: claimed.modbus } }
  })
  return saved?.ok ? saved.workspace : loadWorkspace(home, cwd)
}

/**
 * Sync variant used by hot paths that already hold a freshly loaded workspace
 * and only need the claim without awaiting (caller persists if claimed.claimed).
 * Prefer `ensureWorkspaceClaimed` at service entry points.
 *
 * @param {any} workspace
 * @param {string | undefined} sessionId
 * @returns {{ workspace: any, claimed: boolean }}
 */
export function claimWorkspaceSync(workspace, sessionId) {
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid) return { workspace, claimed: false }
  const claimed = claimLegacyPrivate(workspace?.modbus, sid)
  if (!claimed.claimed) return { workspace: { ...workspace, modbus: claimed.modbus }, claimed: false }
  return { workspace: { ...workspace, modbus: claimed.modbus }, claimed: true }
}

/**
 * Sync counterpart of `ensureWorkspaceClaimed` for hot paths that cannot await
 * (e.g. `listFrames`). Persists a first-opener claim the same way: topology moves
 * into sessionConfigs without bumping configVersion.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {string | undefined} sessionId
 * @returns {any} layered workspace
 */
export function ensureWorkspaceClaimedSync(home, cwd, sessionId) {
  const sid = normalizeScopeSessionId(sessionId)
  const workspace = loadWorkspace(home, cwd)
  if (!sid || !claimLegacyPrivate(workspace.modbus, sid).claimed) return workspace
  const claimed = claimLegacyPrivate(workspace.modbus, sid)
  const saved = saveWorkspace(home, cwd, { modbus: claimed.modbus })
  return saved?.ok ? saved.workspace : loadWorkspace(home, cwd)
}

/**
 * Effective FLAT modbus for the caller.
 *
 * @param {any} source layered workspace (`{ modbus }`) or layered modbus
 * @param {string | undefined} sessionId
 * @returns {any} normalized flat modbus
 */
export function modbusForSession(source, sessionId) {
  const modbus = source && typeof source === 'object' && 'modbus' in source ? source.modbus : source
  const sid = normalizeScopeSessionId(sessionId)
  if (sid || isScopePartitioned(modbus)) return projectModbusForSession(modbus, sid)
  return normalizeModbus(modbus)
}

/**
 * Client-facing workspace: the session's flat view with other sessions' private
 * layers stripped (`share` / `privateClaimSessionId` stay for settings).
 *
 * @param {any} workspace layered workspace
 * @param {string | undefined} sessionId
 * @returns {any}
 */
export function workspaceViewForSession(workspace, sessionId) {
  return { ...workspace, modbus: omitSessionConfigs(modbusForSession(workspace, sessionId)) }
}

/**
 * Persist a legacy-style `{ modbus: patch }` write on behalf of a session.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {string | undefined} sessionId
 * @param {any} input `{ modbus: {...}, ... }` as accepted by applyWorkspacePatch
 * @returns {Promise<any>}
 */
export async function saveSessionModbusPatch(home, cwd, sessionId, input) {
  const sid = normalizeScopeSessionId(sessionId)
  const saved = await workspaceRepository(home).update(cwd, null, async (/** @type {any} */ current) => {
    const base = current || {}
    if (!sid) {
      if (isScopePartitioned(base.modbus) && patchTouchesTopology(input)) {
        return {
          ok: false,
          errorCode: ERROR_CODES.SESSION_REQUIRED,
          error: '该工作区已按会话隔离，配置修改必须携带 sessionId',
        }
      }
      return applyWorkspacePatch(base, input)
    }
    const claimed = claimLegacyPrivate(base.modbus, sid).modbus
    const projected = { ...base, modbus: projectModbusForSession(claimed, sid) }
    const applied = applyWorkspacePatch(projected, input)
    if (!applied || applied.ok === false) return applied
    return {
      ok: true,
      workspace: { ...applied.workspace, modbus: foldModbusFromSession(claimed, applied.workspace.modbus, sid) },
    }
  })
  if (!saved || saved.ok === false) return saved
  return { ...saved, view: modbusForSession(saved.workspace, sid) }
}
