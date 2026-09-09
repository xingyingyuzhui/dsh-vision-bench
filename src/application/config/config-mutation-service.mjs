// @ts-check
import { normalizeModbus } from '../../../bench-devices.mjs'
import { normalizeTimelineEvent, prepend, trimTimeline } from '../../../bench-journal.mjs'
import { notifyConnectionRelease } from '../../../bench-modbus-transport.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { listConnectionStates } from '../../../bench-serial-monitor.mjs'
import { normalizeWorkspace, workspaceKey } from '../../../bench-store.mjs'
import { SESSION_SCOPED_SCOPES, parseOperation } from '../../domain/config/config-operation.mjs'
import { isScopePartitioned, omitSessionConfigs } from '../../domain/modbus/config-scope.mjs'
import { ERROR_CODES, fail } from '../../domain/modbus/errors.mjs'
import { createWorkspaceRepository } from '../../infrastructure/persistence/workspace-repository.mjs'
import { claimLegacyPrivate, foldModbusFromSession, projectModbusForSession } from '../modbus/config-scope-service.mjs'
import { applyConnection, applyDevice } from './config-connection-mutations.mjs'
import { applyFlags, applyPoints } from './config-point-mutations.mjs'
import { applyShare } from './config-share-mutations.mjs'
import { validateWorkspaceConfig } from './config-validation-service.mjs'
import { applyVisualization } from './config-visualization-mutations.mjs'

const TIMELINE_WINDOW = 360

/**
 * @typedef {import('../../types/http-api.js').PostCommitWarning} PostCommitWarning
 * @typedef {(home: string) => { mutateConfig: Function }} RepositoryFactory
 * @typedef {(cwd: string, ids: string[]) => unknown} ReleaseConnections
 * @typedef {(home: string, cwd: string, opts?: object) => Promise<{ connectionStates?: object[] }> | { connectionStates?: object[] }} ListConnectionStates
 */

/**
 * @param {{
 *   repositoryFactory?: RepositoryFactory,
 *   releaseConnections?: ReleaseConnections,
 *   listConnectionStates?: ListConnectionStates,
 * }} [deps]
 */
export function createConfigMutationService(deps = {}) {
  const repositoryFactory =
    deps.repositoryFactory || ((home) => createWorkspaceRepository({ home, keyOf: workspaceKey, normalizeWorkspace }))
  const releaseConnections = deps.releaseConnections || notifyConnectionRelease
  const listStates = deps.listConnectionStates || listConnectionStates

  /**
   * @param {any} spec
   * @returns {Promise<any>}
   */
  async function mutateConfig(spec) {
    const home = spec.home
    const room = requireWorkspaceCwd(spec.cwd)
    if (room.error) return { ok: false, error: room.error }
    const { scope, op, raw } = parseOperation(spec.operation)
    if (!scope || !op) {
      return { ok: false, errorCode: 'UNKNOWN_OP', error: `未知配置操作: ${spec.operation || ''}` }
    }
    if (!Number.isInteger(spec.expectedConfigVersion) || spec.expectedConfigVersion <= 0) {
      return fail(ERROR_CODES.CONFIG_VERSION_REQUIRED, '配置修改必须携带当前 configVersion')
    }
    const sessionId = String(spec.sessionId || '').trim()
    const repo = repositoryFactory(home)
    /** @type {{ releaseConnectionIds?: string[], summary?: string, extras?: any }} */
    let postCommit = {}
    const saved = await repo.mutateConfig(room.cwd, spec.expectedConfigVersion, async (/** @type {any} */ current) => {
      const scoped = resolveMutationScope(current, sessionId, scope)
      if (!scoped.ok) return scoped
      const applied = await applyOperation(
        home,
        room.cwd,
        scoped.workspace,
        {
          scope,
          op,
          raw,
          target: spec.target || {},
          value: spec.value || {},
          source: spec.source || 'user',
          sessionId,
        },
        listStates,
      )
      if (!applied.ok) return applied
      const errors = validateWorkspaceConfig(applied.workspace)
      if (errors.length) {
        return { ok: false, errorCode: 'CONFIG_INVALID', error: errors.join('；') }
      }
      if (scoped.projected) {
        // The operation ran on the session's flat view; fold it back into the layered store.
        applied.workspace.modbus = foldModbusFromSession(scoped.base, applied.workspace.modbus, sessionId)
      }
      const summary = applied.summary || raw
      stampTimeline(applied.workspace, spec.source, sessionId, summary)
      postCommit = {
        releaseConnectionIds: applied.postCommit?.releaseConnectionIds || [],
        summary,
        extras: applied,
      }
      return { ok: true, workspace: applied.workspace }
    })
    if (!saved.ok) return saved
    /** @type {PostCommitWarning[]} */
    const postCommitWarnings = []
    const ids = postCommit.releaseConnectionIds || []
    if (ids.length) {
      try {
        await Promise.resolve(releaseConnections(String(room.cwd), ids || []))
      } catch (error) {
        postCommitWarnings.push({
          code: 'CONNECTION_RELEASE_FAILED',
          message: error instanceof Error ? error.message : String(error || '连接释放失败'),
          connectionIds: ids,
        })
      }
    }
    // User UI edits (HMI / visualization layout drag, point toggles, etc.) must NOT
    // steer/followup the Agent — that burns tokens on every drag. Agent-sourced
    // mutations already get their outcome via the command response. High-impact
    // notices (write reject, endpoint drift, compile/flash failure) still go
    // through notifyBenchEvent / maybeNotifyResult elsewhere.
    const applied = postCommit.extras || {}
    // Callers (UI / agent / points-flags RPC) work on the session's effective topology.
    const workspace = sessionScopedWorkspace(saved.workspace, sessionId)

    return {
      ok: true,
      previousConfigVersion: saved.previousConfigVersion,
      nextConfigVersion: saved.nextConfigVersion,
      changedIds: applied.changedIds || [],
      changedPointIds: applied.changedPointIds || [],
      changedVisualizationIds: applied.changedVisualizationIds || [],
      affectedVisualizations: applied.affectedVisualizations || [],
      affectedAlarms: applied.affectedAlarms || [],
      workspace,
      visualization: workspace.modbus.visualization,
      layout: applied.layout,
      points: workspace.modbus.points,
      connections: workspace.modbus.connections,
      devices: workspace.modbus.devices,
      share: workspace.modbus.share,
      published: applied.published,
      revoked: applied.revoked,
      configVersion: saved.nextConfigVersion,
      postCommitWarnings,
    }
  }

  return { mutateConfig }
}

const defaultConfigMutation = createConfigMutationService()

/**
 * @param {any} spec
 * @returns {Promise<any>}
 */
export async function mutateConfig(spec) {
  return defaultConfigMutation.mutateConfig(spec)
}

/**
 * Decide which modbus layer an operation runs against.
 *
 * - `share.*` edits the layered store directly (publish / revoke move slices between layers).
 * - With a sessionId: claim legacy flat topology for that session if still unclaimed,
 *   then run the op on the session's projected flat view (folded back afterwards).
 * - Without a sessionId: allowed only while the workspace is still unpartitioned
 *   (legacy single-layer behaviour); once any session owns a private layer the caller
 *   must identify itself.
 *
 * @param {any} current layered workspace loaded inside the repository lock
 * @param {string} sessionId
 * @param {string} scope
 * @returns {{ ok: true, workspace: any, base: any, projected: boolean } | { ok: false, errorCode: string, error: string, retryable: boolean, details: Record<string, unknown> }}
 */
function resolveMutationScope(current, sessionId, scope) {
  const claimed = claimLegacyPrivate(current.modbus, sessionId)
  const base = claimed.modbus
  if (!sessionId) {
    if (SESSION_SCOPED_SCOPES.has(scope) && isScopePartitioned(base)) {
      return {
        ok: false,
        errorCode: ERROR_CODES.SESSION_REQUIRED,
        error: '该工作区已按会话隔离，配置修改必须携带 sessionId',
        retryable: false,
        details: {},
      }
    }
    return { ok: true, workspace: current, base, projected: false }
  }
  if (scope === 'share') {
    return { ok: true, workspace: { ...current, modbus: base }, base, projected: false }
  }
  return {
    ok: true,
    workspace: { ...current, modbus: projectModbusForSession(base, sessionId) },
    base,
    projected: true,
  }
}

/**
 * Effective (flat) workspace view for the caller's session; other sessions' private
 * layers are never returned. Without a session the layered store is returned as-is
 * (only reachable for unpartitioned legacy workspaces).
 * @param {any} workspace
 * @param {string} sessionId
 * @returns {any}
 */
function sessionScopedWorkspace(workspace, sessionId) {
  const modbus = sessionId ? projectModbusForSession(workspace.modbus, sessionId) : workspace.modbus
  return { ...workspace, modbus: omitSessionConfigs(modbus) }
}

/**
 * @param {any} workspace
 * @param {any} source
 * @param {any} sessionId
 * @param {any} summary
 * @param {any} extra
 * @returns {any}
 */
function stampTimeline(workspace, source, sessionId, summary, extra = {}) {
  const event = normalizeTimelineEvent({
    kind: extra.kind || 'config',
    source: source === 'agent' || source === 'system' ? source : 'user',
    sessionId: sessionId || '',
    ok: true,
    summary,
    ...extra,
  })
  workspace.timeline = trimTimeline(prepend(workspace.timeline, event, TIMELINE_WINDOW))
  return workspace
}

/**
 * @param {any} home
 * @param {any} cwd
 * @param {any} current
 * @param {any} ctx
 * @param {ListConnectionStates} listStates
 * @returns {Promise<any>}
 */
async function applyOperation(home, cwd, current, ctx, listStates) {
  const { scope, op, target, value, source, sessionId } = ctx
  const pack = normalizeModbus(current.modbus)
  const workspace = normalizeWorkspace(current)
  workspace.modbus = { ...pack }

  if (scope === 'points') return applyPoints(workspace, op, target, value)
  if (scope === 'visualization') return applyVisualization(workspace, op, target, value)
  if (scope === 'connection') return applyConnection(home, cwd, workspace, op, target, value, listStates)
  if (scope === 'device') return applyDevice(workspace, op, target, value)
  if (scope === 'flags') return applyFlags(workspace, op, target, value)
  if (scope === 'share') return applyShare(workspace, op, value, sessionId)
  void source
  return { ok: false, errorCode: 'UNKNOWN_OP', error: `未知配置操作: ${ctx.raw}` }
}
