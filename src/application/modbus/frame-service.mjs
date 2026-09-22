// @ts-check
import { evaluateAlarms, normalizeAlarmState } from '../../domain/modbus/alarm-model.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
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
import { ensureWorkspaceClaimedSync, modbusForSession } from './workspace-session-view.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from './target-resolver-service.mjs'
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
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 */
/**
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusCommandBody} body
 */
export const listFrames = (home, cwd, body) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const origin = originOf(body)
  const workspace = ensureWorkspaceClaimedSync(home, room.cwd, origin.sessionId)
  const pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, origin.sessionId))
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body?.deviceId ? String(body.deviceId).trim() : ''
  const frameId = body && (body.frameId || body.id) ? String(body.frameId || body.id).trim() : ''
  // Agent requires explicit connectionId when multiple connections (frames: device is optional)
  {
    const enabledConns = (pack.connections || []).filter((c) => c.enabled !== false)
    if (origin && origin.source === 'agent' && !cidArg && enabledConns.length > 1) {
      return { ok: false, error: '缺少 connectionId', errorCode: ERROR_CODES.TARGET_REQUIRED }
    }
  }
  // Unified target validation for frames
  if (cidArg || didArg || frameId) {
    const effCid = cidArg || pack.activeConnectionId || pack.connections[0]?.id || ''
    const rt = resolveUnifiedTarget(pack, {
      connectionId: effCid,
      deviceId: didArg || undefined,
      frameId: frameId || undefined,
    })
    if (!rt.ok) {
      // Map missing -> TARGET_REQUIRED, mismatch -> TARGET_MISMATCH
      if (rt.errorCode === TARGET_CODES.TARGET_REQUIRED)
        return { ok: false, error: rt.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
      return {
        ok: false,
        error: rt.error,
        errorCode:
          rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : ERROR_CODES.TARGET_REQUIRED,
      }
    }
  }
  if (cidArg && !pack.connections.some((c) => c.id === cidArg)) {
    return { ok: false, error: `连接不存在: ${cidArg}`, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND }
  }
  if (cidArg) {
    const conn = pack.connections.find((c) => c.id === cidArg)
    if (conn && conn.enabled === false) {
      return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
    }
  }
  if (cidArg && didArg && deviceDisabledOf(pack, cidArg, didArg)) {
    return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
  }
  // Resolve target connection: explicit else active
  const targetCid = cidArg || pack.activeConnectionId || pack.connections[0]?.id || ''
  const hardCap = origin?.source === 'agent' ? 100 : 200
  const limit = Math.max(1, Math.min(hardCap, Number(body?.limit) || 50))
  const offset = Math.max(0, Number(body?.offset) || 0)
  const srcFrames = pack.framesByConnection?.[targetCid] || []
  // Enrich frames with stable id if missing
  const enriched = srcFrames.map((f, idx) => {
    if (f?.id) return f
    const id = `${f?.connectionId ? f.connectionId : targetCid}:${f?.t ? f.t : Date.now()}:${idx}`
    return { ...f, id, frameId: id }
  })
  if (frameId) {
    const hit = enriched.find((f) => f.id === frameId || f.frameId === frameId)
    if (!hit) return { ok: false, error: `报文不存在: ${frameId}`, errorCode: ERROR_CODES.TARGET_MISMATCH }
    // Include stale check: if frame too old? mark stale
    const stale = hit.t && Date.now() - hit.t > 5 * 60 * 1000
    return {
      ok: true,
      frame: hit,
      stale: !!stale,
      connectionId: targetCid,
      configVersion: pack.configVersion || 1,
      errorCode: stale ? ERROR_CODES.STALE_VALUE : undefined,
    }
  }
  const slice = (() => {
    const length = enriched.length
    if (offset >= length) return []
    const end = Math.max(0, length - offset)
    const start = Math.max(0, end - limit)
    return enriched.slice(start, end)
  })()
  // Detect stale: last frame older than 60s?
  const last = enriched[enriched.length - 1]
  const stale = last ? Date.now() - Number(last.t) > 60 * 1000 : false
  return {
    ok: true,
    frames: slice,
    total: enriched.length,
    connectionId: targetCid,
    deviceId: didArg || pack.devices.find((d) => d.connectionId === targetCid)?.id || '',
    configVersion: pack.configVersion || 1,
    stale: !!stale,
    ...(stale ? { errorCode: ERROR_CODES.STALE_VALUE, warning: '报文较旧，可能已过期' } : {}),
  }
}
