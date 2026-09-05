// @ts-check
import {
  connectOp,
  keilBuild,
  keilMap,
  keilScan,
  keilTargets,
  listFrames,
  listPendingWrites,
  modbusPoll,
  modbusRead,
  modbusWrite,
  openocdDownload,
  pointsOp,
  requestFocus,
  resolvePendingWrite,
} from '../../../bench-actions.mjs'
import { listDir } from '../../../bench-actions.mjs'
import { runSelfCheck } from '../../../bench-check.mjs'
import { normalizeModbus } from '../../../bench-devices.mjs'
import { artifactInfo, readBuildLog, readProjectFile } from '../../../bench-fs.mjs'
import { getVisionIoBroker } from '../../../bench-io-broker.mjs'
import { toEndpoint } from '../../../bench-io-contract.mjs'
import { changedConnectionIds, notifyConnectionRelease } from '../../../bench-modbus-transport.mjs'
import { migrateLegacyDisabled } from '../../../bench-modbus.mjs'
import { maybeNotifyResult, notifyBenchEvent } from '../../../bench-notify.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { ensurePolling, pollingStatus, startPolling, stopPolling } from '../../../bench-polling-service.mjs'
import { inspectPresetHealth } from '../../../bench-preset.mjs'
import {
  closeConnectionLink,
  feedConnectionFrames,
  listConnectedSerialSources,
  listConnectionStates,
  openConnectionLink,
} from '../../../bench-serial-monitor.mjs'
import { listSerialPorts } from '../../../bench-serial.mjs'
import {
  appendEvidence,
  journalView,
  loadBindings,
  loadGlobalShare,
  loadWorkspace,
  probeBindings,
  resolveManualRequest,
  saveBindings,
  saveGlobalShare,
  saveWorkspaceAsync,
  touchServiceSession,
  workspaceRepository,
} from '../../../bench-store.mjs'
import { clearFramesByConnection } from '../../../bench-store.mjs'
import { normalizeCommand } from '../../application/commands/command-contract.mjs'
import { losslessCommandResult } from '../../application/commands/lossless-json.mjs'
import { executeVisionCommand } from '../../application/commands/vision-command-service.mjs'
import { mutateConfig } from '../../application/config/config-mutation-service.mjs'
import { clearFlashApprovals } from '../../application/flash/flash-approval-service.mjs'
import { probeOpenOcdHealth } from '../../application/flash/openocd-health-service.mjs'
import { claimLegacyPrivate, projectModbusForSession } from '../../application/modbus/config-scope-service.mjs'
import { isScopePartitioned, omitSessionConfigs } from '../../domain/modbus/config-scope.mjs'
import { createDebugRpcHandler } from './debug-rpc-handler.mjs'
import { createVerifyRpcHandler } from './verify-rpc-handler.mjs'

const WORKSPACE_CONFIG_KEYS = new Set([
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
function normalizeConnAlias(body) {
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
 */
async function touchSessionFromPayload(home, body, endpoint = '') {
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
function workspaceCwdOf(room) {
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
async function loadWorkspaceForSession(home, cwd, sessionId) {
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
function sessionWorkspaceView(workspace, sessionId) {
  const modbus =
    sessionId || isScopePartitioned(workspace.modbus)
      ? projectModbusForSession(workspace.modbus, sessionId)
      : workspace.modbus
  return { ...workspace, modbus: omitSessionConfigs(modbus) }
}

/**
 * @param {string} home
 * @param {string | undefined} cwd
 * @param {string} [sessionId] pending writes are only exposed to their owning session
 */
async function snapshot(home, cwd, sessionId) {
  const bindings = loadBindings(home)
  const globalShare = loadGlobalShare(home)
  /** @type {Record<string, any>} */
  const body = {
    ok: true,
    bindings,
    globalShare,
    health: probeBindings(bindings),
    ioRuntime: getVisionIoBroker().snapshot(),
    presetHealth: inspectPresetHealth(home),
  }
  const room = cwd ? requireWorkspaceCwd(cwd) : { error: 'no-cwd' }
  const workspaceCwd = workspaceCwdOf(room)
  if (workspaceCwd) {
    try {
      await migrateLegacyDisabled(home, workspaceCwd)
    } catch {
      /* migration best-effort */
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
    const states = await listConnectionStates(home, workspaceCwd)
    body.connectionStates = states.connectionStates || []
  }
  return body
}

/**
 * @param {{
 *   getHome: () => string,
 *   debugRuntime?: any,
 *   debugRpcHandler?: (endpoint: string, body: any, signal?: AbortSignal) => Promise<any>,
 *   verifyRpcHandler?: (endpoint: string, body: any, signal?: AbortSignal) => Promise<any>,
 *   verifyCommandService?: any,
 *   telemetryReader?: any,
 * }} deps
 * @returns {{ dispatch: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>, snapshot: (cwd?: string, sessionId?: string) => Promise<unknown> }}
 */
export function createVisionRpcRouter(deps) {
  const { getHome } = deps
  const debugRpc = deps.debugRpcHandler || createDebugRpcHandler(deps)
  const verifyRpc = deps.verifyRpcHandler || createVerifyRpcHandler(deps)

  /**
   * @param {string} endpoint
   * @param {unknown} payload
   * @param {AbortSignal | undefined} signal
   */
  async function dispatch(endpoint, payload, signal) {
    const home = getHome()
    /** @type {Record<string, any>} */
    const body = payload && typeof payload === 'object' ? /** @type {Record<string, any>} */ (payload) : {}
    const operationOptions = signal ? { signal } : {}
    await touchSessionFromPayload(home, body, endpoint)

    if (endpoint.startsWith('debug/')) {
      return debugRpc(endpoint, body, signal)
    }

    if (endpoint.startsWith('verify/') || endpoint.startsWith('vision.verify.')) {
      const handler = /** @type {any} */ (verifyRpc)[endpoint]
      if (handler) {
        return handler(body)
      }
    }

    switch (endpoint) {
      case 'state':
        return snapshot(home, String(body.cwd || '') || undefined, String(body.sessionId || ''))
      case 'bindings/get':
        return {
          ok: true,
          bindings: loadBindings(home),
          globalShare: loadGlobalShare(home),
          health: probeBindings(loadBindings(home)),
        }
      case 'bindings/save': {
        const saved = saveBindings(home, body && typeof body === 'object' ? body.bindings : undefined)
        if (!saved.ok) return saved
        if (body && body.share !== undefined) {
          saveGlobalShare(home, body.share)
        }
        const sid = body && typeof body === 'object' ? String(body.sessionId || '').trim() : ''
        const cwd = body && typeof body === 'object' ? String(body.cwd || '').trim() : ''
        if (cwd && body.share !== undefined) {
          try {
            await mutateConfig({
              home,
              cwd,
              sessionId: sid,
              source: 'user',
              action: 'config',
              payload: {
                cwd,
                operation: 'share.update',
                value: { share: body.share, confirmed: true },
              },
            })
          } catch {
            /* workspace sync best-effort */
          }
        }
        return {
          ok: true,
          bindings: saved.bindings,
          globalShare: loadGlobalShare(home),
          health: probeBindings(saved.bindings),
        }
      }
      case 'workspace/get': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const sid = body && typeof body === 'object' ? String(body.sessionId || '').trim() : ''
        const ws = loadWorkspace(home, room.cwd)
        return {
          ok: true,
          workspace: sessionWorkspaceView(ws, sid),
          journal: journalView(ws),
        }
      }
      case 'workspace/save': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const modbus = body && typeof body === 'object' ? body.modbus : undefined
        if (modbus && Object.keys(modbus).some((key) => WORKSPACE_CONFIG_KEYS.has(key))) {
          return {
            ok: false,
            errorCode: 'CONFIG_COMMAND_REQUIRED',
            error: '连接、设备、点位、可视化及会话配置必须使用增量配置命令',
          }
        }
        const sid = body && typeof body === 'object' ? String(body.sessionId || '').trim() : ''
        // When the workspace is partitioned, activeConnectionId / activeDeviceId
        // must also be written to sessionConfigs[sid] because projectModbusForSession
        // reads them from the private slice (not top-level).
        const runtimeModbus =
          modbus && typeof modbus === 'object' ? /** @type {Record<string, unknown>} */ (modbus) : {}
        const touchesActiveId =
          runtimeModbus.activeConnectionId !== undefined || runtimeModbus.activeDeviceId !== undefined
        let patchModbus = modbus
        if (sid && touchesActiveId) {
          const cur = loadWorkspace(home, room.cwd)
          if (isScopePartitioned(cur.modbus)) {
            const sc = cur.modbus.sessionConfigs || {}
            const sess = sc[sid] && typeof sc[sid] === 'object' ? { ...sc[sid] } : {}
            if (runtimeModbus.activeConnectionId !== undefined)
              sess.activeConnectionId = runtimeModbus.activeConnectionId
            if (runtimeModbus.activeDeviceId !== undefined) sess.activeDeviceId = runtimeModbus.activeDeviceId
            patchModbus = { ...runtimeModbus, sessionConfigs: { ...sc, [sid]: sess } }
          }
        }
        const prev = loadWorkspace(home, room.cwd)
        const saved = await saveWorkspaceAsync(home, room.cwd, {
          keil: body && typeof body === 'object' ? body.keil : undefined,
          modbus: patchModbus,
        })
        if (!saved.ok) return { ok: false, error: saved.error, workspace: saved.workspace }
        notifyConnectionRelease(room.cwd, changedConnectionIds(prev.modbus, saved.workspace.modbus))
        const viewWorkspace = sessionWorkspaceView(saved.workspace, sid)
        return { ok: true, workspace: viewWorkspace, journal: journalView(saved.workspace) }
      }
      case 'fs/list':
        return listDir(
          body && typeof body === 'object' ? body.cwd : undefined,
          body && typeof body === 'object' ? body.path : undefined,
        )
      case 'project/file': {
        const room = body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return readProjectFile(room.cwd, body && typeof body === 'object' ? body.path || body.file : undefined)
      }
      case 'keil/log':
        return readBuildLog(home, body && typeof body === 'object' ? body.logFile : undefined)
      case 'keil/artifact':
        return artifactInfo(
          body && typeof body === 'object' ? body.cwd : undefined,
          body && typeof body === 'object' ? body.path : undefined,
        )
      case 'keil/download': {
        const ran = await openocdDownload(
          home,
          body && typeof body === 'object' ? body.cwd : undefined,
          body,
          operationOptions,
        )
        if (ran && !ran.needsConfirm)
          maybeNotifyResult(home, body && typeof body === 'object' ? body.cwd : undefined, '烧录', ran)
        return ran
      }
      case 'keil/scan':
        return keilScan(home, body && typeof body === 'object' ? body.cwd : undefined)
      case 'keil/targets':
        return keilTargets(
          home,
          body && typeof body === 'object' ? body.cwd : undefined,
          body && typeof body === 'object' ? body.project : undefined,
        )
      case 'keil/map':
        return keilMap(
          home,
          body && typeof body === 'object' ? body.cwd : undefined,
          body && typeof body === 'object' ? body.project : undefined,
          body && typeof body === 'object' ? body.target : undefined,
        )
      case 'keil/build': {
        const ran = await keilBuild(
          home,
          body && typeof body === 'object' ? body.cwd : undefined,
          body,
          operationOptions,
        )
        maybeNotifyResult(home, body && typeof body === 'object' ? body.cwd : undefined, '编译', ran)
        return ran
      }
      case 'modbus/read':
        return modbusRead(home, body.cwd, normalizeConnAlias(body), operationOptions)
      case 'modbus/write': {
        const ran = await modbusWrite(home, body.cwd, normalizeConnAlias(body), operationOptions)
        maybeNotifyResult(home, String(body.cwd || ''), '写点', ran)
        return ran
      }
      case 'modbus/write/approve': {
        const room = requireWorkspaceCwd(body.cwd)
        const workspaceCwd = workspaceCwdOf(room)
        if (!workspaceCwd) return { ok: false, error: room.error || 'no-cwd' }
        const ran = await resolvePendingWrite(home, workspaceCwd, String(body.id || ''), body.approved === true, {
          ...operationOptions,
          source: 'user',
          sessionId: String(body.sessionId || ''),
        })
        maybeNotifyResult(home, workspaceCwd, '写点', ran)
        return ran
      }
      case 'modbus/connect':
        return connectOp(home, body.cwd, normalizeConnAlias(body), {})
      case 'modbus/points':
        return pointsOp(home, body.cwd, normalizeConnAlias(body))
      case 'points/flags': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const expected = body && typeof body === 'object' ? body.expectedConfigVersion : undefined
        if (!Number.isInteger(expected) || expected <= 0) {
          return {
            ok: false,
            errorCode: 'CONFIG_VERSION_REQUIRED',
            error: '配置修改必须携带当前 configVersion',
          }
        }
        /** @type {Record<string, boolean>} */
        const patch = {}
        if (Object.prototype.hasOwnProperty.call(body, 'monitorEnabled')) {
          patch.monitorEnabled = Boolean(body.monitorEnabled)
        }
        if (Object.prototype.hasOwnProperty.call(body, 'alarmEnabled')) {
          patch.alarmEnabled = Boolean(body.alarmEnabled)
        }
        let incomingSessionId = (body && typeof body === 'object' ? body.sessionId : '') || ''
        if (!incomingSessionId) {
          const ws = loadWorkspace(home, room.cwd)
          if (ws?.session?.boundId) {
            incomingSessionId = ws.session.boundId
          }
        }
        const ran = await mutateConfig({
          home,
          cwd: room.cwd,
          source: body && typeof body === 'object' && body.source === 'agent' ? 'agent' : 'user',
          sessionId: incomingSessionId,
          expectedConfigVersion: body && typeof body === 'object' ? body.expectedConfigVersion : undefined,
          operation: 'flags.update',
          target: { pointId: body && typeof body === 'object' ? body.pointId : undefined },
          value: patch,
        })
        if (!ran || ran.ok === false) {
          const errorCode = ran && ran.errorCode === 'POINT_NOT_FOUND' ? 'NOT_FOUND' : ran?.errorCode
          const error =
            ran && ran.errorCode === 'CONFIG_DRIFT' ? '点位配置已更新，请刷新后重试' : ran?.error || '保存失败'
          return { ok: false, error, errorCode }
        }
        const pointId = String((body && typeof body === 'object' ? body.pointId : '') || '')
        const points = ran.workspace?.modbus?.points || []
        const point = points.find((/** @type {{ id?: string }} */ item) => item && item.id === pointId)
        const configVersion = ran.nextConfigVersion || ran.workspace?.modbus?.configVersion
        return { ok: true, point, configVersion, workspace: ran.workspace }
      }
      case 'frames/list':
        return listFrames(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
      case 'frames/clear': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        return clearFramesByConnection(home, room.cwd, {
          connectionId: body && typeof body === 'object' ? body.connectionId : undefined,
          all: body && typeof body === 'object' ? body.all === true : false,
        })
      }
      case 'focus':
        return requestFocus(home, body.cwd, normalizeConnAlias(/** @type {any} */ (body)))
      case 'evidence': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const ev = body && typeof body === 'object' ? body.evidence || body.evidences || body.item : undefined
        const list = Array.isArray(ev) ? ev : ev ? [ev] : []
        if (!list.length) return { ok: false, error: '缺少 evidence' }
        return appendEvidence(home, room.cwd, list, String(body.sessionId || ''))
      }
      case 'manual/resolve': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const ran = await resolveManualRequest(
          home,
          room.cwd,
          body && typeof body === 'object' ? body.id : undefined,
          body && typeof body === 'object' ? body.done !== false : true,
        )
        if (ran.ok && ran.request) {
          void notifyBenchEvent(
            home,
            room.cwd,
            `人工操作${ran.request.status === 'done' ? '已完成' : '无法完成'}：${ran.request.text}`,
            '',
            { sessionId: ran.request.sessionId },
          ).catch(() => {})
        }
        return ran
      }
      case 'modbus/poll':
        return modbusPoll(home, body.cwd, normalizeConnAlias(/** @type {any} */ (body)))
      case 'polling/start': {
        const room = body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return startPolling(home, room.cwd, body)
      }
      case 'polling/stop': {
        const room = body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return stopPolling(home, room.cwd, body)
      }
      case 'polling/status': {
        const room = body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return pollingStatus(home, room.cwd)
      }
      case 'connection/open': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const pack = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
        const conn = pack.connections.find(
          (/** @type {{ id: string }} */ c) => c.id === (body.connectionId || body.connId),
        )
        if (!conn) return { ok: false, error: '连接不存在' }
        if (conn.conn?.sim) return { ok: true, skipped: true, simulated: true }
        return openConnectionLink(room.cwd, { connectionId: conn.id, endpoint: toEndpoint(conn) })
      }
      case 'connection/close': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        return closeConnectionLink(
          room.cwd,
          body && typeof body === 'object' ? body.connectionId || body.connId : undefined,
        )
      }
      case 'serial/ports':
        return listSerialPorts()
      case 'serial/sources': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        return listConnectedSerialSources(home, room.cwd)
      }
      case 'selfcheck':
        return runSelfCheck(home, body && typeof body === 'object' ? body.cwd : undefined)
      case 'openocd/probe':
        return probeOpenOcdHealth(home)
      case 'serial/feed': {
        const room = requireWorkspaceCwd(body.cwd)
        if (room.error) return { ok: false, error: room.error }
        return feedConnectionFrames(room.cwd, {
          connectionId: String(body.connectionId || ''),
          since: body.since,
        })
      }
      case 'command': {
        const payloadBody = body.payload || body
        return losslessCommandResult(
          await executeVisionCommand({
            ...normalizeCommand(body),
            home,
            payload: payloadBody,
            action: String(body.action || payloadBody?.action || ''),
          }),
        )
      }
      default:
        return {
          ok: false,
          errorCode: 'NOT_FOUND',
          error: `unknown vision endpoint: ${endpoint}`,
        }
    }
  }

  return { dispatch, snapshot: (cwd, sessionId) => snapshot(getHome(), cwd, sessionId) }
}

export { clearFlashApprovals }
