// @ts-check
import { normalizeModbus, normalizePointV3, validateConnections } from '../../../bench-devices.mjs'
import { normalizeTimelineEvent, prepend, trimTimeline } from '../../../bench-journal.mjs'
import { notifyConnectionRelease } from '../../../bench-modbus-transport.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { listConnectionStates } from '../../../bench-serial-monitor.mjs'
import { normalizeWorkspace, workspaceKey } from '../../../bench-store.mjs'
import {
  migrateVisualizationToV2,
  normalizeComponentLayout,
  normalizeVisualizationComponent,
  parseVisualizationLayoutItems,
  validateVisualizationComponent,
  visualizationSchemaGuard,
} from '../../../bench-visualization-model.mjs'
import { SESSION_SCOPED_SCOPES, explicitId, parseOperation } from '../../domain/config/config-operation.mjs'
import { isScopePartitioned, omitSessionConfigs } from '../../domain/modbus/config-scope.mjs'
import { ERROR_CODES, fail } from '../../domain/modbus/errors.mjs'
import { applyPointPatch } from '../../domain/modbus/point-patch.mjs'
import { resolveHierarchy } from '../../domain/modbus/target-resolver.mjs'
import { pickConnPatch } from '../../domain/modbus/validation.mjs'
import { createWorkspaceRepository } from '../../infrastructure/persistence/workspace-repository.mjs'
import {
  applyShareFlags,
  claimLegacyPrivate,
  foldModbusFromSession,
  projectModbusForSession,
} from '../modbus/config-scope-service.mjs'
import { validateWorkspaceConfig } from './config-validation-service.mjs'

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
 * @param {any} list
 * @returns {any}
 */
function idsOfPoints(list) {
  return (Array.isArray(list) ? list : []).map((/** @type {any} */ p) => p?.id).filter(Boolean)
}

/**
 * @param {any} components
 * @param {any} pointIds
 * @returns {any}
 */
function vizAffected(components, pointIds) {
  const set = new Set(pointIds)
  return (components || [])
    .filter((/** @type {any} */ c) => (c.pointIds || []).some((/** @type {any} */ id) => set.has(id)))
    .map((/** @type {any} */ c) => c.id)
}

/**
 * @param {any} alarmState
 * @param {any} pointIds
 * @returns {any}
 */
function alarmAffected(alarmState, pointIds) {
  const set = new Set(pointIds)
  return Object.keys(alarmState || {}).filter((/** @type {any} */ id) => set.has(id))
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

/**
 * `share.update`: flags may arrive as `value.share` or flat on `value`; `value.confirmed`
 * acknowledges the revoke dialog. Runs on the LAYERED modbus (see resolveMutationScope).
 * @param {any} workspace
 * @param {any} op
 * @param {any} value
 * @param {string} sessionId
 * @returns {any}
 */
function applyShare(workspace, op, value, sessionId) {
  if (op !== 'update') return { ok: false, errorCode: 'UNKNOWN_OP', error: 'share 仅支持 update' }
  const src = value && typeof value === 'object' ? value : {}
  const flags = src.share && typeof src.share === 'object' ? src.share : src
  const ran = applyShareFlags(workspace.modbus, sessionId, flags, { confirmed: src.confirmed === true })
  if (!ran.ok) {
    return {
      ok: false,
      errorCode: ran.errorCode,
      error: ran.error,
      needsConfirm: ran.needsConfirm === true,
      revoked: ran.revoked || [],
    }
  }
  workspace.modbus = ran.modbus
  const parts = []
  if (ran.published.length) parts.push(`共享 ${ran.published.join('/')}`)
  if (ran.revoked.length) parts.push(`取消共享 ${ran.revoked.join('/')}`)
  return {
    ok: true,
    workspace,
    summary: parts.length ? `工作区共享：${parts.join('；')}` : '更新工作区共享设置',
    changedIds: [],
    share: ran.modbus.share,
    published: ran.published,
    revoked: ran.revoked,
  }
}

/**
 * @param {any} pack
 * @param {any} removedIds
 * @returns {any}
 */
function scrubPointRuntime(pack, removedIds) {
  const drop = new Set(removedIds)
  pack.values = (pack.values || []).filter((/** @type {any} */ v) => !drop.has(v.key || v.pointId))
  const trend = { ...(pack.trend || {}) }
  for (const id of drop) delete trend[id]
  pack.trend = trend
  const alarmState = { ...(pack.alarmState || {}) }
  const alarmActive = { ...(pack.alarmActive || {}) }
  for (const id of drop) {
    delete alarmState[id]
    delete alarmActive[id]
  }
  pack.alarmState = alarmState
  pack.alarmActive = alarmActive
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
function applyPoints(workspace, op, target, value) {
  const pack = workspace.modbus
  const cid = explicitId(target.connectionId || value.connectionId || value.connId)
  const did = explicitId(target.deviceId || value.deviceId)
  if (op === 'clear') {
    if (!cid || !did) {
      return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'clear 必须明确 connectionId 与 deviceId' }
    }
    const scoped = resolveHierarchy(pack, { connectionId: cid, deviceId: did })
    if (!scoped.ok) return scoped
    const removed = pack.points.filter((/** @type {any} */ p) => p.connectionId === cid && p.deviceId === did)
    pack.points = pack.points.filter((/** @type {any} */ p) => !(p.connectionId === cid && p.deviceId === did))
    const removedIds = idsOfPoints(removed)
    scrubPointRuntime(pack, removedIds)
    return finishPoints(workspace, removedIds, `清空点位 ${cid}/${did} ${removedIds.length} 个`)
  }
  if (op === 'remove') {
    const ids = Array.isArray(value.ids) ? value.ids.map(String) : []
    const one = explicitId(target.pointId || value.id || value.pointId)
    if (one) ids.push(one)
    if (!ids.length) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 pointId' }
    for (const pid of ids) {
      const scoped = resolveHierarchy(pack, {
        connectionId: cid || undefined,
        deviceId: did || undefined,
        pointId: pid,
      })
      if (!scoped.ok) return scoped
    }
    const idSet = new Set(ids)
    const removed = pack.points.filter((/** @type {any} */ p) => idSet.has(p.id))
    if (!removed.length) return { ok: false, errorCode: 'POINT_NOT_FOUND', error: '没有匹配的点位' }
    pack.points = pack.points.filter((/** @type {any} */ p) => !idSet.has(p.id))
    scrubPointRuntime(pack, idsOfPoints(removed))
    return finishPoints(workspace, idsOfPoints(removed), `删除点位 ${ids.join(',')}`)
  }
  if (op === 'add' || op === 'update') {
    const inputs = Array.isArray(value.points)
      ? value.points
      : value.point
        ? [value.point]
        : value.id || value.function
          ? [value]
          : []
    if (!inputs.length) return { ok: false, error: '缺少 points 或 point' }
    const changed = []
    let points = pack.points.slice()
    for (const input of inputs) {
      const raw = { ...(input || {}) }
      if (op === 'add') {
        const inCid = explicitId(raw.connectionId || raw.connId) || cid
        const inDid = explicitId(raw.deviceId) || did
        const scoped = resolveHierarchy(pack, { connectionId: inCid, deviceId: inDid })
        if (!scoped.ok) return scoped
        raw.connectionId = inCid
        raw.deviceId = inDid
        const next = normalizePointV3(raw)
        if (
          points.some((/** @type {any} */ p) => p.id === next.id) ||
          points.some(
            (/** @type {any} */ p) =>
              p.connectionId === next.connectionId &&
              p.deviceId === next.deviceId &&
              p.function === next.function &&
              p.address === next.address,
          )
        ) {
          return { ok: false, error: `点位已存在: ${next.id}` }
        }
        points = points.concat([next])
        changed.push(next.id)
      } else {
        const pid = explicitId(raw.id || target.pointId)
        if (!pid) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 pointId' }
        const scoped = resolveHierarchy(pack, {
          connectionId: cid || explicitId(raw.connectionId || raw.connId) || undefined,
          deviceId: did || explicitId(raw.deviceId) || undefined,
          pointId: pid,
        })
        if (!scoped.ok) return scoped
        const idx = points.findIndex((/** @type {any} */ p) => p.id === pid)
        const existing = points[idx]
        const patched = applyPointPatch(existing, raw)
        if (!patched.ok) return patched
        points[idx] = {
          ...existing,
          ...patched.point,
          id: existing.id,
          connectionId: existing.connectionId,
          deviceId: existing.deviceId,
        }
        changed.push(existing.id)
      }
    }
    pack.points = points
    return finishPoints(workspace, changed, `${op === 'add' ? '添加' : '更新'}点位 ${changed.join(',')}`)
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'points op 必须是 add|update|remove|clear' }
}

/**
 * @param {any} workspace
 * @param {any} changedPointIds
 * @param {any} summary
 * @returns {any}
 */
function finishPoints(workspace, changedPointIds, summary) {
  const pack = workspace.modbus
  return {
    ok: true,
    workspace,
    summary,
    changedIds: changedPointIds,
    changedPointIds,
    affectedVisualizations: vizAffected(pack.visualization?.components, changedPointIds),
    affectedAlarms: alarmAffected(pack.alarmState, changedPointIds),
  }
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
function applyVisualization(workspace, op, target, value) {
  const pack = workspace.modbus
  const guard = visualizationSchemaGuard(pack.visualization)
  if (!guard.ok) return { ok: false, errorCode: guard.errorCode, error: guard.error }
  const migrated = migrateVisualizationToV2(pack.visualization, pack.points)
  if (migrated && migrated.ok === false) return migrated
  const viz = /** @type {any} */ (migrated)
  const id = explicitId(target.visualizationId || value.visualizationId || value.id || value.component?.id)
  if (op === 'add') {
    const cand = normalizeVisualizationComponent({ ...(value.component || value), id: '' })
    const v = validateVisualizationComponent(cand, pack.points)
    if (!v.ok) return { ok: false, error: v.error, errorCode: 'VIZ_INVALID' }
    viz.components = viz.components.concat([cand])
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `添加可视化 ${cand.id}`,
      changedIds: [cand.id],
      changedVisualizationIds: [cand.id],
      visualization: viz,
      component: cand,
    }
  }
  if (op === 'update') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 visualizationId' }
    const idx = viz.components.findIndex((/** @type {any} */ c) => c.id === id)
    if (idx < 0) return { ok: false, error: `组件不存在: ${id}`, errorCode: 'VIZ_NOT_FOUND' }
    const raw = value.component || value
    if (explicitId(raw.id) && explicitId(raw.id) !== id) {
      return {
        ok: false,
        errorCode: 'VIZ_TARGET_MISMATCH',
        error: `component.id 与 visualizationId 不一致: ${raw.id} vs ${id}`,
      }
    }
    const cand = normalizeVisualizationComponent({ ...viz.components[idx], ...raw, id: viz.components[idx].id })
    const v = validateVisualizationComponent(cand, pack.points)
    if (!v.ok) return { ok: false, error: v.error, errorCode: 'VIZ_INVALID' }
    viz.components = viz.components.map((/** @type {any} */ c, /** @type {number} */ i) => (i === idx ? cand : c))
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `更新可视化 ${id}`,
      changedIds: [id],
      changedVisualizationIds: [id],
      visualization: viz,
      component: cand,
    }
  }
  if (op === 'remove') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 visualizationId' }
    const idx = viz.components.findIndex((/** @type {any} */ c) => c.id === id)
    if (idx < 0) return { ok: false, error: `组件不存在: ${id}`, errorCode: 'VIZ_NOT_FOUND' }
    viz.components = viz.components.filter((/** @type {any} */ c) => c.id !== id)
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `删除可视化 ${id}`,
      changedIds: [id],
      changedVisualizationIds: [id],
      visualization: viz,
    }
  }
  if (op === 'layout') {
    const parsed = parseVisualizationLayoutItems(value.items, viz.components)
    if (!parsed.ok) return parsed
    const layoutItems = parsed.ok ? parsed.items : []
    const byId = new Map(layoutItems.map((/** @type {any} */ row) => [row.id, row.layout]))
    /** @type {string[]} */
    const changed = []
    viz.components = viz.components.map((/** @type {any} */ c, /** @type {number} */ i) => {
      const nextLayout = byId.get(c.id)
      if (!nextLayout) return c
      changed.push(c.id)
      return normalizeVisualizationComponent({ ...c, layout: normalizeComponentLayout(nextLayout, i, c.type) }, i)
    })
    pack.visualization = viz
    return {
      ok: true,
      workspace,
      summary: `更新可视化布局 ${changed.length} 项`,
      changedIds: changed,
      changedVisualizationIds: changed,
      visualization: viz,
      layout: viz.components.map((/** @type {any} */ c) => ({ id: c.id, ...(c.layout || {}) })),
    }
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'visualization op 必须是 add|update|remove|layout' }
}

/**
 * @param {any} home
 * @param {any} cwd
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @param {ListConnectionStates} listStates
 * @returns {Promise<any>}
 */
async function applyConnection(home, cwd, workspace, op, target, value, listStates) {
  const pack = workspace.modbus
  const id = explicitId(target.connectionId || value.connectionId || value.connId || value.id)
  if (op === 'create') {
    const nextId = id || `c${Date.now().toString(36)}`
    if (pack.connections.some((/** @type {any} */ c) => c.id === nextId)) {
      return { ok: false, error: `连接已存在: ${nextId}` }
    }
    const conn = {
      id: nextId,
      name: String(value.name || nextId).slice(0, 40),
      role: value.role === 'server' || value.role === 'slave' ? value.role : 'client',
      enabled: value.enabled !== false,
      conn: {
        mode: 'rtu',
        baudrate: 9600,
        bytesize: 8,
        parity: 'N',
        stopbits: 1,
        tcpPort: 502,
        sim: false,
        ...pickConnPatch(value.conn || value),
      },
    }
    pack.connections = pack.connections.concat([conn])
    const errs = validateConnections(pack.connections, pack.devices)
    if (errs.length) return { ok: false, errorCode: 'CONFIG_INVALID', error: errs.join('；') }
    return { ok: true, workspace, summary: `创建连接 ${nextId}`, changedIds: [nextId], connectionId: nextId }
  }
  if (op === 'remove') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 connectionId' }
    const hit = pack.connections.find((/** @type {any} */ c) => c.id === id)
    if (!hit) return { ok: false, errorCode: 'CONNECTION_NOT_FOUND', error: `连接不存在: ${id}` }
    const removedPoints = pack.points.filter((/** @type {any} */ p) => p.connectionId === id)
    pack.connections = pack.connections.filter((/** @type {any} */ c) => c.id !== id)
    pack.devices = pack.devices.filter((/** @type {any} */ d) => d.connectionId !== id)
    pack.points = pack.points.filter((/** @type {any} */ p) => p.connectionId !== id)
    scrubPointRuntime(pack, idsOfPoints(removedPoints))
    if (pack.activeConnectionId === id) {
      pack.activeConnectionId = pack.connections[0]?.id || ''
      pack.activeDeviceId =
        pack.devices.find((/** @type {any} */ d) => d.connectionId === pack.activeConnectionId)?.id || ''
    } else if (pack.activeDeviceId) {
      const still = pack.devices.find(
        (/** @type {any} */ d) => d.id === pack.activeDeviceId && d.connectionId === pack.activeConnectionId,
      )
      if (!still) {
        pack.activeDeviceId =
          pack.devices.find((/** @type {any} */ d) => d.connectionId === pack.activeConnectionId)?.id || ''
      }
    }
    if (pack.pollingByConnection) {
      const nextPoll = { ...pack.pollingByConnection }
      delete nextPoll[id]
      pack.pollingByConnection = nextPoll
    }
    if (pack.framesByConnection) {
      const nextFrames = { ...pack.framesByConnection }
      delete nextFrames[id]
      pack.framesByConnection = nextFrames
    }
    void cwd
    return {
      ok: true,
      workspace,
      summary: `删除连接 ${id}`,
      changedIds: [id],
      postCommit: { releaseConnectionIds: [id] },
    }
  }
  if (op === 'update') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 connectionId' }
    const hit = pack.connections.find((/** @type {any} */ c) => c.id === id)
    if (!hit) return { ok: false, error: `连接不存在: ${id}` }
    const patch = pickConnPatch(value.conn || value)
    if (Object.keys(patch).length) {
      const states = await listStates(home, cwd)
      /**
       * @param {any} s
       * @returns {any}
       */
      const live = /** @type {any} */ (
        (states.connectionStates || []).find((/** @type {any} */ s) => s.connectionId === id)
      )
      const busy =
        live && (live.status === 'connected' || live.status === 'connecting' || live.status === 'disconnecting')
      if (busy) {
        return { ok: false, errorCode: 'CONNECTION_BUSY', error: '修改已连接端点前请先断开' }
      }
    }
    pack.connections = pack.connections.map((/** @type {any} */ c) => {
      if (c.id !== id) return c
      return {
        ...c,
        name: value.name != null ? String(value.name).slice(0, 40) : c.name,
        enabled: value.enabled != null ? value.enabled !== false : c.enabled,
        conn: { ...c.conn, ...patch },
      }
    })
    const errs = validateConnections(pack.connections, pack.devices)
    if (errs.length) return { ok: false, errorCode: 'CONFIG_INVALID', error: errs.join('；') }
    return {
      ok: true,
      workspace,
      summary: `更新连接 ${id}`,
      changedIds: [id],
      connectionId: id,
      postCommit: { releaseConnectionIds: Object.keys(patch).length ? [id] : [] },
    }
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'connection op 必须是 create|update|remove' }
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
function applyDevice(workspace, op, target, value) {
  const pack = workspace.modbus
  const id = explicitId(target.deviceId || value.deviceId || value.id)
  const cid = explicitId(target.connectionId || value.connectionId || value.connId)
  if (op === 'create') {
    if (!cid) return { ok: false, errorCode: 'TARGET_REQUIRED', error: '创建设备必须携带 connectionId' }
    const nextId = id || `d${Date.now().toString(36)}`
    const unitId = Math.trunc(Number(value.unitId != null ? value.unitId : value.slave))
    pack.devices = pack.devices.concat([
      {
        id: nextId,
        connectionId: cid,
        name: String(value.name || nextId).slice(0, 40),
        unitId: Number.isFinite(unitId) ? unitId : 1,
        enabled: value.enabled !== false,
      },
    ])
    return { ok: true, workspace, summary: `添加设备 ${nextId}`, changedIds: [nextId], deviceId: nextId }
  }
  if (op === 'remove') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 deviceId' }
    const scoped = resolveHierarchy(pack, { connectionId: cid || undefined, deviceId: id })
    if (!scoped.ok) return scoped
    const removed = pack.devices.find((/** @type {any} */ d) => d.id === id)
    const removedPoints = pack.points.filter((/** @type {any} */ p) => p.deviceId === id)
    pack.devices = pack.devices.filter((/** @type {any} */ d) => d.id !== id)
    pack.points = pack.points.filter((/** @type {any} */ p) => p.deviceId !== id)
    scrubPointRuntime(pack, idsOfPoints(removedPoints))
    if (pack.activeDeviceId === id) {
      const connectionId = removed?.connectionId || pack.activeConnectionId
      pack.activeDeviceId = pack.devices.find((/** @type {any} */ d) => d.connectionId === connectionId)?.id || ''
    }
    return { ok: true, workspace, summary: `删除设备 ${id}`, changedIds: [id] }
  }
  if (op === 'update') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 deviceId' }
    const hit = pack.devices.find((/** @type {any} */ d) => d.id === id)
    if (!hit) return { ok: false, error: `设备不存在: ${id}` }
    pack.devices = pack.devices.map((/** @type {any} */ d) => {
      if (d.id !== id) return d
      const unitArg = value.unitId != null ? value.unitId : value.slave
      const unitId = unitArg == null ? d.unitId : Math.trunc(Number(unitArg))
      return {
        ...d,
        name: value.name != null ? String(value.name).slice(0, 40) : d.name,
        unitId,
        enabled: value.enabled != null ? value.enabled !== false : d.enabled,
      }
    })
    return { ok: true, workspace, summary: `更新设备 ${id}`, changedIds: [id], deviceId: id }
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'device op 必须是 create|update|remove' }
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
function applyFlags(workspace, op, target, value) {
  if (op !== 'update') return { ok: false, errorCode: 'UNKNOWN_OP', error: 'flags 仅支持 update' }
  const pid = explicitId(target.pointId || value.pointId || value.id)
  if (!pid) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'flags.update 必须携带 pointId' }
  const src = value && typeof value === 'object' ? value : {}
  const hasMonitor = src.monitorEnabled !== undefined
  const hasAlarm = src.alarmEnabled !== undefined
  if (!hasMonitor && !hasAlarm) {
    return { ok: false, error: '缺少 monitorEnabled 或 alarmEnabled' }
  }
  if (hasMonitor && typeof src.monitorEnabled !== 'boolean') {
    return { ok: false, error: 'monitorEnabled 必须是布尔值' }
  }
  if (hasAlarm && typeof src.alarmEnabled !== 'boolean') {
    return { ok: false, error: 'alarmEnabled 必须是布尔值' }
  }
  const pack = workspace.modbus
  const scoped = resolveHierarchy(pack, {
    connectionId: explicitId(target.connectionId),
    deviceId: explicitId(target.deviceId),
    pointId: pid,
  })
  if (!scoped.ok) return scoped
  const idx = pack.points.findIndex((/** @type {any} */ p) => p.id === pid)
  /** @type {{ monitorEnabled?: boolean, alarmEnabled?: boolean }} */
  const patch = {}
  if (hasMonitor) patch.monitorEnabled = src.monitorEnabled
  if (hasAlarm) patch.alarmEnabled = src.alarmEnabled
  const patched = applyPointPatch(pack.points[idx], patch)
  if (!patched.ok) return patched
  pack.points = pack.points.map((/** @type {any} */ p, /** @type {any} */ i) => (i === idx ? patched.point : p))
  return finishPoints(workspace, [pid], `更新点位开关 ${pid}`)
}
