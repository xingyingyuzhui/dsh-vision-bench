// @ts-check

/**
 * Workspace / snapshot helpers for the Vision RPC router.
 * Extracted so the switch dispatcher stays under the structure budget
 * without changing endpoint contracts.
 */

import { listPendingWrites, migrateLegacyDisabled } from '../../application/modbus/index.mjs'
import { claimLegacyPrivate, projectModbusForSession } from '../../application/modbus/config-scope-service.mjs'
import { ensurePolling } from '../../application/modbus/polling-coordinator.mjs'
import { isScopePartitioned, omitSessionConfigs } from '../../domain/modbus/config-scope.mjs'
import { inspectPresetHealth } from '../../infrastructure/harness/preset.mjs'
import { getVisionIoBroker } from '../../infrastructure/modbus/io-broker.mjs'
import {
  listConnectedSerialSources,
  listConnectionStates,
} from '../../infrastructure/modbus/serial-monitor.mjs'
import { loadBindings, probeBindings } from '../../infrastructure/store/bindings-store.mjs'
import { loadGlobalShare } from '../../infrastructure/store/global-share-store.mjs'
import { journalView, touchServiceSession } from '../../infrastructure/store/journal-store.mjs'
import { loadWorkspace, workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'

export const WORKSPACE_CONFIG_KEYS = new Set([
  'conn',
  'connections',
  'devices',
  'points',
  'visualization',
  'sessionConfigs',
  'share',
  'privateClaimSessionId',
])

/**
 * @param {unknown} body
 * @returns {any}
 */
export function normalizeConnAlias(body) {
  if (!body || typeof body !== 'object') return body
  const row = /** @type {Record<string, unknown>} */ (body)
  if (row.connId && !row.connectionId) row.connectionId = row.connId
  if (row.connectionId && !row.connId) row.connId = row.connectionId
  if (Array.isArray(row.points)) {
    for (const p of row.points) {
      if (p && typeof p === 'object') {
        const point = /** @type {Record<string, unknown>} */ (p)
        if (point.connId && !point.connectionId) point.connectionId = point.connId
        if (point.connectionId && !point.connId) point.connId = point.connectionId
      }
    }
  }
  if (row.point && typeof row.point === 'object') {
    const p = /** @type {Record<string, unknown>} */ (row.point)
    if (p.connId && !p.connectionId) p.connectionId = p.connId
    if (p.connectionId && !p.connId) p.connId = p.connectionId
  }
  return body
}

/**
 * @param {string} home
 * @param {unknown} body
 * @param {string} [endpoint]
 */
export async function touchSessionFromPayload(home, body, endpoint = '') {
  if (endpoint === 'debug/events/wait') return
  const row = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {}
  const payload =
    row.payload && typeof row.payload === 'object' ? /** @type {Record<string, unknown>} */ (row.payload) : {}
  const action = row.action || payload.action
  if (action !== 'system.ping' && row.cwd && row.sessionId) {
    await touchServiceSession(home, String(row.cwd), String(row.sessionId))
  }
}

/** @param {{ error?: string, cwd?: string }} room */
export function workspaceCwdOf(room) {
  return room && !room.error && room.cwd ? String(room.cwd) : ''
}

/**
 * Load the layered workspace and, when a session is present, let it claim a legacy
 * flat topology as its private config. The claim is persisted once and does NOT bump
 * configVersion: the claiming session's effective topology is unchanged, so pending
 * approvals / cached views it holds must stay valid.
 * @param {string} home
 * @param {string} cwd
 * @param {string} sessionId
 */
export async function loadWorkspaceForSession(home, cwd, sessionId) {
  const workspace = loadWorkspace(home, cwd)
  const globalShare = loadGlobalShare(home)
  if (globalShare.enabled && (!workspace.modbus.share || !workspace.modbus.share.enabled)) {
    workspace.modbus.share = { ...globalShare }
  }
  if (!sessionId || !claimLegacyPrivate(workspace.modbus, sessionId).claimed) return workspace
  const saved = await workspaceRepository(home).update(cwd, null, async (/** @type {any} */ current) => {
    const claimed = claimLegacyPrivate(current.modbus, sessionId)
    if (!claimed.claimed) return { ok: false, errorCode: 'CLAIM_RACE', error: 'workspace already claimed' }
    return { ok: true, workspace: { ...current, modbus: claimed.modbus } }
  })
  // Lost the race (another session claimed in between) or write failed: fall back to the on-disk truth.
  return saved?.ok ? saved.workspace : loadWorkspace(home, cwd)
}

/**
 * Effective flat topology for the caller. Anonymous callers see the flat layer only while
 * the workspace is still unpartitioned; afterwards they see no private topology.
 * @param {any} workspace layered workspace
 * @param {string} sessionId
 */
export function sessionWorkspaceView(workspace, sessionId) {
  const modbus =
    sessionId || isScopePartitioned(workspace.modbus)
      ? projectModbusForSession(workspace.modbus, sessionId)
      : workspace.modbus
  return { ...workspace, modbus: omitSessionConfigs(modbus) }
}

const migratedCwds = new Set()
let presetHealthAt = 0
/** @type {any} */
let presetHealthCached = null
let presetHealthHome = ''

/**
 * @param {string} home
 * @param {string | undefined} cwd
 * @param {string} [sessionId] pending writes are only exposed to their owning session
 */
export async function snapshot(home, cwd, sessionId) {
  const bindings = loadBindings(home)
  const globalShare = loadGlobalShare(home)
  const now = Date.now()
  if (!presetHealthCached || presetHealthHome !== home || now - presetHealthAt > 30000) {
    presetHealthCached = await inspectPresetHealth(home)
    presetHealthAt = now
    presetHealthHome = home
  }
  /** @type {Record<string, any>} */
  const body = {
    ok: true,
    bindings,
    globalShare,
    health: probeBindings(bindings),
    ioRuntime: getVisionIoBroker().snapshot(),
    presetHealth: presetHealthCached,
  }
  const room = cwd ? requireWorkspaceCwd(cwd) : { error: 'no-cwd' }
  const workspaceCwd = workspaceCwdOf(room)
  if (workspaceCwd) {
    if (!migratedCwds.has(workspaceCwd)) {
      try {
        await migrateLegacyDisabled(home, workspaceCwd)
      } catch {
        /* migration best-effort */
      }
      migratedCwds.add(workspaceCwd)
    }
    try {
      ensurePolling(home, workspaceCwd)
    } catch {
      /* polling best-effort */
    }
    const session = String(sessionId || '').trim()
    const workspace = await loadWorkspaceForSession(home, workspaceCwd, session)
    body.workspace = sessionWorkspaceView(workspace, session)
    body.journal = journalView(body.workspace)
    body.pendingWrites = listPendingWrites(workspaceCwd, sessionId)
    const sources = await listConnectedSerialSources(home, workspaceCwd)
    body.serialSources = sources.sources || []
    const states = await listConnectionStates(home, workspaceCwd, {
      pack: body.workspace?.modbus,
      sessionId: session,
    })
    body.connectionStates = states.connectionStates || []
  }
  return body
}
