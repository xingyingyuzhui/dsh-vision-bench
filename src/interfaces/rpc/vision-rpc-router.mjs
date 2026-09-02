// @ts-check
import {
  connectOp,
  keilBuild,
  keilMap,
  keilScan,
  keilTargets,
  listFrames,
  modbusPoll,
  modbusRead,
  modbusWrite,
  openocdDownload,
  pointsOp,
  requestFocus,
  resolvePendingWrite,
  listPendingWrites,
} from '../../../bench-actions.mjs'
import { runSelfCheck } from '../../../bench-check.mjs'
import { normalizeModbus } from '../../../bench-devices.mjs'
import { artifactInfo, readBuildLog, readProjectFile } from '../../../bench-fs.mjs'
import { getVisionIoBroker } from '../../../bench-io-broker.mjs'
import { toEndpoint } from '../../../bench-io-contract.mjs'
import { changedConnectionIds, notifyConnectionRelease } from '../../../bench-modbus-transport.mjs'
import { migrateLegacyDisabled } from '../../../bench-modbus.mjs'
import { maybeNotifyResult, notifyBenchEvent } from '../../../bench-notify.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { clearFlashApprovals } from '../../application/flash/flash-approval-service.mjs'
import { probeOpenOcdHealth } from '../../application/flash/openocd-health-service.mjs'
import { mutateConfig } from '../../application/config/config-mutation-service.mjs'
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
  loadWorkspace,
  probeBindings,
  resolveManualRequest,
  saveBindings,
  saveWorkspaceAsync,
  touchServiceSession,
} from '../../../bench-store.mjs'
import { clearFramesByConnection } from '../../../bench-store.mjs'
import { normalizeCommand } from '../../application/commands/command-contract.mjs'
import { losslessCommandResult } from '../../application/commands/lossless-json.mjs'
import { executeVisionCommand } from '../../application/commands/vision-command-service.mjs'
import { listDir } from '../../../bench-actions.mjs'

const WORKSPACE_CONFIG_KEYS = new Set(['conn', 'connections', 'devices', 'points', 'visualization'])

/**
 * @param {unknown} body
 * @returns {unknown}
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
async function touchSessionFromPayload(home, body) {
  const row = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {}
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const action = row.action || payload.action
  if (action !== 'system.ping' && row.cwd && row.sessionId) {
    await touchServiceSession(home, String(row.cwd), String(row.sessionId))
  }
}

/**
 * @param {string} home
 * @param {string | undefined} cwd
 */
async function snapshot(home, cwd) {
  const bindings = loadBindings(home)
  const body = {
    ok: true,
    bindings,
    health: probeBindings(bindings),
    ioRuntime: getVisionIoBroker().snapshot(),
    presetHealth: inspectPresetHealth(home),
  }
  const room = cwd ? requireWorkspaceCwd(cwd) : { error: 'no-cwd' }
  if (!room.error) {
    try {
      await migrateLegacyDisabled(home, room.cwd)
    } catch {
      /* migration best-effort */
    }
    try {
      ensurePolling(home, room.cwd)
    } catch {
      /* polling best-effort */
    }
    const workspace = loadWorkspace(home, room.cwd)
    body.workspace = workspace
    body.journal = journalView(body.workspace)
    body.pendingWrites = listPendingWrites(room.cwd)
    const sources = await listConnectedSerialSources(home, room.cwd)
    body.serialSources = sources.sources || []
    const states = await listConnectionStates(home, room.cwd)
    body.connectionStates = states.connectionStates || []
  }
  return body
}

/**
 * @param {{ getHome: () => string }} deps
 * @returns {{ dispatch: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>, snapshot: (cwd?: string) => Promise<unknown> }}
 */
export function createVisionRpcRouter({ getHome }) {
  /**
   * @param {string} endpoint
   * @param {unknown} payload
   * @param {AbortSignal | undefined} signal
   */
  async function dispatch(endpoint, payload, signal) {
    void signal
    const home = getHome()
    const body = payload && typeof payload === 'object' ? payload : {}
    await touchSessionFromPayload(home, body)

    switch (endpoint) {
      case 'state':
        return snapshot(home, body && typeof body === 'object' ? String(body.cwd || '') || undefined : undefined)
      case 'bindings/get':
        return {
          ok: true,
          bindings: loadBindings(home),
          health: probeBindings(loadBindings(home)),
        }
      case 'bindings/save': {
        const saved = saveBindings(home, body && typeof body === 'object' ? body.bindings : undefined)
        if (!saved.ok) return saved
        return { ok: true, bindings: saved.bindings, health: probeBindings(saved.bindings) }
      }
      case 'workspace/get': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        return { ok: true, workspace: loadWorkspace(home, room.cwd), journal: journalView(loadWorkspace(home, room.cwd)) }
      }
      case 'workspace/save': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const modbus = body && typeof body === 'object' ? body.modbus : undefined
        if (modbus && Object.keys(modbus).some((key) => WORKSPACE_CONFIG_KEYS.has(key))) {
          return {
            ok: false,
            errorCode: 'CONFIG_COMMAND_REQUIRED',
            error: '连接、设备、点位与可视化配置必须使用增量配置命令',
          }
        }
        const prev = loadWorkspace(home, room.cwd)
        const saved = await saveWorkspaceAsync(home, room.cwd, {
          keil: body && typeof body === 'object' ? body.keil : undefined,
          modbus: body && typeof body === 'object' ? body.modbus : undefined,
        })
        if (!saved.ok) return { ok: false, error: saved.error, workspace: saved.workspace }
        notifyConnectionRelease(room.cwd, changedConnectionIds(prev.modbus, saved.workspace.modbus))
        return { ok: true, workspace: saved.workspace, journal: journalView(saved.workspace) }
      }
      case 'fs/list':
        return listDir(body && typeof body === 'object' ? body.cwd : undefined, body && typeof body === 'object' ? body.path : undefined)
      case 'project/file': {
        const room =
          body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return readProjectFile(
          room.cwd,
          body && typeof body === 'object' ? body.path || body.file : undefined,
        )
      }
      case 'keil/log':
        return readBuildLog(home, body && typeof body === 'object' ? body.logFile : undefined)
      case 'keil/artifact':
        return artifactInfo(body && typeof body === 'object' ? body.cwd : undefined, body && typeof body === 'object' ? body.path : undefined)
      case 'keil/download': {
        const ran = await openocdDownload(home, body && typeof body === 'object' ? body.cwd : undefined, body)
        if (ran && !ran.needsConfirm) maybeNotifyResult(home, body && typeof body === 'object' ? body.cwd : undefined, '烧录', ran)
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
        const ran = await keilBuild(home, body && typeof body === 'object' ? body.cwd : undefined, body)
        maybeNotifyResult(home, body && typeof body === 'object' ? body.cwd : undefined, '编译', ran)
        return ran
      }
      case 'modbus/read':
        return modbusRead(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
      case 'modbus/write': {
        const ran = await modbusWrite(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
        maybeNotifyResult(home, body && typeof body === 'object' ? body.cwd : undefined, '写点', ran)
        return ran
      }
      case 'modbus/write/approve': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const ran = await resolvePendingWrite(
          home,
          room.cwd,
          body && typeof body === 'object' ? body.id : undefined,
          (body && typeof body === 'object' ? body.approved : undefined) === true,
        )
        maybeNotifyResult(home, room.cwd, '写点', ran)
        return ran
      }
      case 'modbus/connect':
        return connectOp(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
      case 'modbus/points':
        return pointsOp(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
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
        const patch = {}
        if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'monitorEnabled')) {
          patch.monitorEnabled = body.monitorEnabled
        }
        if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'alarmEnabled')) {
          patch.alarmEnabled = body.alarmEnabled
        }
        const ran = await mutateConfig({
          home,
          cwd: room.cwd,
          source: body && typeof body === 'object' && body.source === 'agent' ? 'agent' : 'user',
          sessionId: (body && typeof body === 'object' ? body.sessionId : '') || '',
          expectedConfigVersion: body && typeof body === 'object' ? body.expectedConfigVersion : undefined,
          operation: 'flags.update',
          target: { pointId: body && typeof body === 'object' ? body.pointId : undefined },
          value: patch,
        })
        if (!ran || ran.ok === false) {
          const errorCode = ran && ran.errorCode === 'POINT_NOT_FOUND' ? 'NOT_FOUND' : ran && ran.errorCode
          const error =
            ran && ran.errorCode === 'CONFIG_DRIFT' ? '点位配置已更新，请刷新后重试' : (ran && ran.error) || '保存失败'
          return { ok: false, error, errorCode }
        }
        const pointId = String((body && typeof body === 'object' ? body.pointId : '') || '')
        const points = (ran.workspace && ran.workspace.modbus && ran.workspace.modbus.points) || []
        const point = points.find((item) => item && item.id === pointId)
        const configVersion =
          ran.nextConfigVersion || (ran.workspace && ran.workspace.modbus && ran.workspace.modbus.configVersion)
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
        return requestFocus(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
      case 'evidence': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const ev =
          body && typeof body === 'object' ? body.evidence || body.evidences || body.item : undefined
        const list = Array.isArray(ev) ? ev : ev ? [ev] : []
        if (!list.length) return { ok: false, error: '缺少 evidence' }
        return appendEvidence(home, room.cwd, list)
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
            '人工操作' + (ran.request.status === 'done' ? '已完成' : '无法完成') + '：' + ran.request.text,
            '',
            { sessionId: ran.request.sessionId },
          ).catch(() => {})
        }
        return ran
      }
      case 'modbus/poll':
        return modbusPoll(home, body && typeof body === 'object' ? body.cwd : undefined, normalizeConnAlias(body))
      case 'polling/start': {
        const room =
          body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return startPolling(home, room.cwd, body)
      }
      case 'polling/stop': {
        const room =
          body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return stopPolling(home, room.cwd, body)
      }
      case 'polling/status': {
        const room =
          body && typeof body === 'object' && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
        if (room.error) return { ok: false, error: room.error }
        return pollingStatus(home, room.cwd)
      }
      case 'connection/open': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        const pack = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
        const conn = pack.connections.find(
          (c) => c.id === ((body && typeof body === 'object' ? body.connectionId || body.connId : undefined)),
        )
        if (!conn) return { ok: false, error: '连接不存在' }
        if (conn.conn && conn.conn.sim) return { ok: true, skipped: true, simulated: true }
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
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error) return { ok: false, error: room.error }
        return feedConnectionFrames(room.cwd, {
          connectionId: (body && typeof body === 'object' ? body.connectionId : '') || '',
          since: body && typeof body === 'object' ? body.since : undefined,
        })
      }
      case 'command':
        return losslessCommandResult(
          await executeVisionCommand({
            ...normalizeCommand(body),
            home,
            payload: body && typeof body === 'object' ? body.payload || body : body,
            action: body && typeof body === 'object' ? body.action || body.payload?.action : undefined,
          }),
        )
      default:
        return {
          ok: false,
          errorCode: 'NOT_FOUND',
          error: `unknown vision endpoint: ${endpoint}`,
        }
    }
  }

  return { dispatch, snapshot: (cwd) => snapshot(getHome(), cwd) }
}

export { clearFlashApprovals }
