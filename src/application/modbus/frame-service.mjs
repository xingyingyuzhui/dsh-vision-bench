// @ts-check
import { evaluateAlarms, normalizeAlarmState } from '../../../bench-alarm.mjs'
import { normalizeModbus, normalizePointV3 } from '../../../bench-devices.mjs'
import { pickArtifact } from '../../../bench-fs.mjs'
import { toEndpoint } from '../../../bench-io-contract.mjs'
import { aborted, hasRunning, originOf, signalOf } from '../../../bench-journal.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from '../../../bench-modbus-commit.mjs'
import { notifyBenchEvent } from '../../../bench-notify.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import {
  clampInt,
  decodeValue,
  evaluateAlarm,
  evaluatePointAlarms,
  fillSimValues,
  functionTag,
  isWritableFunction,
  normalizePoints,
  normalizeWriteValues,
  pointIdOf,
  pointLabel,
  scatterBatch,
  setPointValue,
} from '../../../bench-points.mjs'
import { planScopedReadBatches } from '../../../bench-pollplan.mjs'
import { portKey } from '../../../bench-portlock.mjs'
import {
  finishTask,
  loadWorkspace,
  normalizeFocusRequest,
  normalizeFocusState,
  openTask,
  pruneBuildLogs,
  recordBenchEvent,
  saveWorkspace,
} from '../../../bench-store.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from '../../../bench-targets.mjs'
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
  const workspace = loadWorkspace(home, room.cwd)
  const pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  const origin = originOf(body)
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
  const limit = Math.max(1, Math.min(200, Number(body?.limit) || 50))
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
  const slice = enriched.slice(Math.max(0, enriched.length - limit - offset), enriched.length - offset)
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
