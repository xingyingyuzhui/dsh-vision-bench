// @ts-check
import { listWorkspaceDir as listDir } from '../../infrastructure/files/project-fs.mjs'
import { keilMap, keilScan, keilTargets } from '../../application/keil/project-service.mjs'
import { keilBuild } from '../../application/keil/build-service.mjs'
import { openocdDownload } from '../../application/flash/flash-service.mjs'
import {
  connectOp,
  listFrames,
  modbusPoll,
  modbusRead,
  modbusWrite,
  pointsOp,
  requestFocus,
  resolvePendingWrite,
} from '../../application/modbus/index.mjs'
import { runSelfCheck } from '../../application/system/self-check.mjs'
import { normalizeModbus } from '../../application/modbus/modbus-migration.mjs'
import { artifactInfo, readBuildLog, readProjectFile } from '../../infrastructure/files/project-fs.mjs'
import { toEndpoint } from '../../domain/modbus/io-contract.mjs'
import { changedConnectionIds, notifyConnectionRelease } from '../../infrastructure/modbus/modbus-transport.mjs'
import { maybeNotifyResult, notifyBenchEvent } from '../../infrastructure/host/notify.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { pollingStatus, startPolling, stopPolling } from '../../application/modbus/polling-coordinator.mjs'
import {
  closeConnectionLink,
  feedConnectionFrames,
  listConnectedSerialSources,
  openConnectionLink,
  setSimConnectionState,
} from '../../infrastructure/modbus/serial-monitor.mjs'
import { listSerialPorts } from '../../infrastructure/modbus/serial-ports.mjs'
import { appendEvidence, journalView, resolveManualRequest } from '../../infrastructure/store/journal-store.mjs'
import { loadBindings, probeBindings, saveBindings } from '../../infrastructure/store/bindings-store.mjs'
import { loadGlobalShare, saveGlobalShare } from '../../infrastructure/store/global-share-store.mjs'
import { loadWorkspace, saveWorkspaceAsync } from '../../infrastructure/store/workspace-store.mjs'
import { clearFramesByConnection } from '../../infrastructure/store/journal-store.mjs'
import { normalizeCommand } from '../../application/commands/command-contract.mjs'
import { losslessCommandResult } from '../../application/commands/lossless-json.mjs'
import { executeVisionCommand } from '../../application/commands/vision-command-service.mjs'
import { mutateConfig } from '../../application/config/config-mutation-service.mjs'
import { clearFlashApprovals } from '../../application/flash/flash-approval-service.mjs'
import { probeOpenOcdHealth } from '../../application/flash/openocd-health-service.mjs'
import { projectModbusForSession } from '../../application/modbus/config-scope-service.mjs'
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { createDebugRpcHandler } from './debug-rpc-handler.mjs'
import { createVerifyRpcHandler } from './verify-rpc-handler.mjs'
import {
  WORKSPACE_CONFIG_KEYS,
  loadWorkspaceForSession,
  normalizeConnAlias,
  sessionWorkspaceView,
  snapshot,
  touchSessionFromPayload,
  workspaceCwdOf,
} from './vision-rpc-workspace.mjs'

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
      // `home` must travel with the request: the debug launch chain reads
      // bindings.json and workspace.json, and without it `loadBindings(undefined)`
      // silently degrades to "user has configured nothing".
      return debugRpc(endpoint, { ...body, home: body.home || home }, signal)
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
        return modbusPoll(home, body.cwd, { ...operationOptions, ...normalizeConnAlias(/** @type {any} */ (body)) })
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
        if (room.error || !room.cwd) return { ok: false, error: room.error || 'no-cwd' }
        const cwd = room.cwd
        const session = String((body && typeof body === 'object' ? body.sessionId : '') || '').trim()
        const ws = session ? await loadWorkspaceForSession(home, cwd, session) : loadWorkspace(home, cwd)
        const pack = normalizeModbus(session ? projectModbusForSession(ws.modbus, session) : ws.modbus)
        const conn = pack.connections.find(
          (/** @type {{ id: string }} */ c) => c.id === (body.connectionId || body.connId),
        )
        if (!conn) return { ok: false, error: '连接不存在' }
        if (conn.conn?.sim || conn.sim) {
          setSimConnectionState(cwd, conn.id, 'connected')
          await startPolling(home, cwd, { connectionId: conn.id })
          return { ok: true, skipped: true, simulated: true }
        }
        return openConnectionLink(cwd, { connectionId: conn.id, endpoint: toEndpoint(conn) })
      }
      case 'connection/close': {
        const room = requireWorkspaceCwd(body && typeof body === 'object' ? body.cwd : undefined)
        if (room.error || !room.cwd) return { ok: false, error: room.error || 'no-cwd' }
        const cwd = room.cwd
        const session = String((body && typeof body === 'object' ? body.sessionId : '') || '').trim()
        const ws = session ? await loadWorkspaceForSession(home, cwd, session) : loadWorkspace(home, cwd)
        const pack = normalizeModbus(session ? projectModbusForSession(ws.modbus, session) : ws.modbus)
        const conn = pack.connections.find(
          (/** @type {{ id: string }} */ c) => c.id === (body.connectionId || body.connId),
        )
        if (conn && (conn.conn?.sim || conn.sim)) {
          setSimConnectionState(cwd, conn.id, 'disconnected')
          await stopPolling(home, cwd, { connectionId: conn.id })
          return { ok: true, skipped: true, simulated: true }
        }
        return closeConnectionLink(cwd, body && typeof body === 'object' ? body.connectionId || body.connId : undefined)
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
