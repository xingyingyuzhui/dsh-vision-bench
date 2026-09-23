// @ts-check
import { evaluateAlarms, normalizeAlarmState } from '../../domain/modbus/alarm-model.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import { normalizePointV3 } from '../../domain/modbus/point-model.mjs'
import { pickArtifact } from '../../infrastructure/files/project-fs.mjs'
import { toEndpoint } from '../../domain/modbus/io-contract.mjs'
import { aborted, hasRunning, originOf, signalOf } from '../../domain/modbus/journal-model.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from './modbus-commit.mjs'
import { notifyBenchEvent } from '../../infrastructure/host/notify.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { clampInt, fillSimValues, functionTag, normalizePoints, normalizeWriteValues, pointLabel, scatterBatch, setPointValue } from '../../domain/modbus/point-model.mjs'
import { decodeValue, isWritableFunction, pointIdOf } from '../../domain/modbus/point-math.mjs'
import { evaluateAlarm, evaluatePointAlarms } from '../../domain/modbus/point-alarm.mjs'
import { planScopedReadBatches } from '../../domain/modbus/poll-plan.mjs'
import { portKey } from '../../infrastructure/modbus/port-lock.mjs'
import { finishTask, openTask, pruneBuildLogs, recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { normalizeFocusRequest, normalizeFocusState } from '../../infrastructure/store/focus-store.mjs'
import { ensureWorkspaceClaimed, modbusForSession, saveSessionModbusPatch } from './workspace-session-view.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from '../../domain/modbus/target-resolver-service.mjs'
import { endpointFingerprint, endpointLabelText, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3, fnOfPoint } from '../../domain/modbus/function-code.mjs'
import { compactPointRow, isStaleValue } from '../../domain/modbus/point-value.mjs'
import { stampPoints } from '../../domain/modbus/unit-id.mjs'
import { connReady, deviceDisabledOf, pickConnPatch, targetRequired } from '../../domain/modbus/validation.mjs'
import {
  changedConnectionIds,
  createModbusTransport,
  notifyConnectionRelease,
  toReadRequest,
  toWriteRequest,
} from '../../infrastructure/modbus/transport-adapter.mjs'
import {
  PENDING_TTL_MS,
  POLL_BUDGET_MS,
  alarmLabel,
  alarmSummary,
  createTransactionFrame,
  entryLabel,
  frameEntry,
  framesOf,
  pendingState,
  pendingWrites,
  pickModbusPatch,
  pointBefore,
  pointValuesOfBatch,
  pollLocks,
  prunePendingWrites,
  runReadTx,
  transportOf,
} from './modbus-runtime-context.mjs'
/**
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 */
/**
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusCommandBody} body
 * @param {ModbusOperationOptions} opts
 */
export const connectOp = async (home, cwd, body, opts = {}) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const origin = originOf(body)
  const sessionId = String(opts?.sessionId || origin.sessionId || body?.sessionId || '')
  const cidRaw = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  if (cidRaw) {
    const workspace = await ensureWorkspaceClaimed(home, room.cwd, sessionId)
    const pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, sessionId))
    const target = pack.connections.find((c) => c.id === cidRaw)
    if (!target) return { ok: false, error: `连接不存在: ${cidRaw}` }
    const role = target.role || 'client'
    // close 优先 — 仅凭 connectionId 即可断开，不要求 patch
    const transport = transportOf(opts)
    if (body && body.close === true) {
      await transport.closeConnection({ cwd: room.cwd, connectionId: cidRaw })
      return {
        ok: true,
        action: 'connect',
        connectionId: cidRaw,
        connId: cidRaw,
        configured: !!(body && Object.keys(pickConnPatch(body)).length),
        connected: false,
        live: 'disconnected',
      }
    }
    // legacy slave/unitId：仅在明确 deviceId 时更新该设备 Unit ID，永不写入 connection.conn
    const unitArg = body && (body.slave !== undefined ? body.slave : body.unitId)
    let nextDevices = pack.devices
    if (unitArg !== undefined) {
      const devId = String(body?.deviceId || '').trim()
      if (!devId) {
        return { ok: false, error: '修改 Unit ID 需要提供 deviceId', code: 'DEVICE_ID_REQUIRED', connectionId: cidRaw }
      }
      const hit = pack.devices.find((d) => d.id === devId && d.connectionId === cidRaw)
      if (!hit) return { ok: false, error: `设备不存在: ${devId}`, code: 'DEVICE_NOT_FOUND', connectionId: cidRaw }
      const unit = Math.trunc(Number(unitArg))
      if (!Number.isFinite(unit) || unit < 1 || unit > 247) {
        return {
          ok: false,
          error: 'Unit ID 必须是 1..247（不支持广播 0）',
          code: 'UNIT_ID_INVALID',
          connectionId: cidRaw,
          deviceId: devId,
        }
      }
      nextDevices = pack.devices.map((d) => (d.id === devId ? { ...d, unitId: unit } : d))
    }
    const patch = pickConnPatch(body)
    let outConn = target.conn
    if (Object.keys(patch).length || unitArg !== undefined) {
      const nextConns = Object.keys(patch).length
        ? pack.connections.map((c) => (c.id === cidRaw ? { ...c, conn: { ...c.conn, ...patch } } : c))
        : pack.connections
      const saved = await saveSessionModbusPatch(home, room.cwd, sessionId, {
        modbus: { connections: nextConns, devices: nextDevices, version: 3 },
      })
      if (!saved.ok) return saved
      notifyConnectionRelease(
        room.cwd,
        changedConnectionIds(workspace.modbus, saved.workspace.modbus).filter((id) => id !== cidRaw),
      )
      const savedPack = /** @type {ModbusWorkspace} */ (saved.view || modbusForSession(saved.workspace, sessionId))
      outConn = savedPack.connections.find((c) => c.id === cidRaw)?.conn || savedPack.conn
    }
    if (outConn && outConn.sim === true) {
      await transport.closeConnection({ cwd: room.cwd, connectionId: cidRaw })
      return {
        ok: true,
        action: 'connect',
        conn: outConn,
        connectionId: cidRaw,
        connId: cidRaw,
        configured: !!Object.keys(patch).length,
        simulated: true,
      }
    }
    const opened = await transport.openConnection({
      cwd: room.cwd,
      connectionId: cidRaw,
      endpoint: toEndpoint({ ...target, conn: outConn, role }),
    })
    if (opened.ok === false) {
      // Task5/0.19.2: 配置已保存但物理连接失败 — 不偷偷回滚
      return {
        ok: false,
        action: 'connect',
        connectionId: cidRaw,
        connId: cidRaw,
        configured: !!Object.keys(patch).length,
        connected: false,
        conn: outConn,
        error: opened.error?.message || String(opened.error || ''),
      }
    }
    return {
      ok: true,
      action: 'connect',
      conn: outConn,
      connectionId: cidRaw,
      connId: cidRaw,
      configured: !!Object.keys(patch).length,
      connected: true,
      live: opened.data || opened,
    }
  }
  // legacy no-id path (kept for backward compat)
  const prev = await ensureWorkspaceClaimed(home, room.cwd, sessionId)
  const saved = await saveSessionModbusPatch(home, room.cwd, sessionId, { modbus: { conn: pickConnPatch(body) } })
  if (!saved.ok) return saved
  notifyConnectionRelease(room.cwd, changedConnectionIds(prev.modbus, saved.workspace.modbus))
  const view = saved.view || modbusForSession(saved.workspace, sessionId)
  return { ok: true, action: 'connect', conn: view.conn }
}

export { pickModbusPatch }
