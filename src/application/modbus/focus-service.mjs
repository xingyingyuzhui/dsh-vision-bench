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
  normalizeFocusRequest,
  normalizeFocusState,
  openTask,
  pruneBuildLogs,
  recordBenchEvent,
  saveWorkspaceAsync,
} from '../../../bench-store.mjs'
import { ensureWorkspaceClaimed, modbusForSession } from './workspace-session-view.mjs'
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
export const requestFocus = async (home, cwd, body) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const origin = originOf(body)
  const workspace = await ensureWorkspaceClaimed(home, room.cwd, origin.sessionId)
  const pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, origin.sessionId))
  const rawTarget = body && (body.target || body.focus || body) ? body.target || body.focus || body : {}
  const target =
    normalizeFocusRequest(rawTarget) ||
    normalizeFocusRequest({
      connectionId: rawTarget.connectionId || rawTarget.connId,
      deviceId: rawTarget.deviceId,
      pointId: rawTarget.pointId,
      frameId: rawTarget.frameId,
      trendKey: rawTarget.trendKey,
      alarmId: rawTarget.alarmId,
      visualizationId: rawTarget.visualizationId,
      kind: rawTarget.kind,
      version: pack.configVersion || 1,
      by: origin.source === 'agent' ? 'agent' : 'user',
    })
  if (!target)
    return {
      ok: false,
      error: '缺少聚焦目标 connectionId/deviceId/pointId/frameId',
      errorCode: ERROR_CODES.TARGET_REQUIRED,
    }
  const rt = resolveUnifiedTarget(pack, target)
  if (!rt.ok) {
    if (rt.errorCode === 'VIZ_NOT_FOUND') return { ok: false, error: rt.error, errorCode: 'VIZ_NOT_FOUND' }
    const code =
      rt.errorCode === TARGET_CODES.TARGET_REQUIRED
        ? ERROR_CODES.TARGET_REQUIRED
        : rt.errorCode === TARGET_CODES.TARGET_MISMATCH
          ? ERROR_CODES.TARGET_MISMATCH
          : ERROR_CODES.TARGET_REQUIRED
    // map not-found variants to MISMATCH for unified view
    if (/不存在/.test(String(rt.error || '')) && code === ERROR_CODES.TARGET_REQUIRED)
      return { ok: false, error: rt.error, errorCode: ERROR_CODES.TARGET_MISMATCH }
    return { ok: false, error: rt.error, errorCode: code }
  }
  if (target.connectionId && target.deviceId && deviceDisabledOf(pack, target.connectionId, target.deviceId)) {
    return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
  }
  // Temporal check: ENDPOINT_DRIFT if target's endpoint fingerprint changed?
  // For focus, we treat endpoint drift as warning but not error.
  const prev = workspace.focus ? workspace.focus.request : null
  const nextReq = {
    connectionId: target.connectionId || '',
    deviceId: target.deviceId || '',
    pointId: target.pointId || '',
    frameId: target.frameId || '',
    trendKey: target.trendKey || '',
    alarmId: target.alarmId || '',
    visualizationId: target.visualizationId || '',
    kind: target.kind || '',
    at: Date.now(),
    by: origin.source === 'agent' ? 'agent' : 'user',
    version: pack.configVersion || 1,
  }
  const tempWatchIds = Array.isArray(body.tempWatchIds)
    ? body.tempWatchIds
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 32)
    : Array.isArray(body.tempWatch)
      ? body.tempWatch
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 32)
      : []
  const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 20) : []
  const wantForeground = body.foreground === true
  const badgeOnly = !!(body.badgeOnly === true || (origin.source === 'agent' && !wantForeground))
  const sessionId = String(origin.sessionId || body.sessionId || '')
  const saved = await saveWorkspaceAsync(home, room.cwd, {
    focus: {
      sessionId,
      request: nextReq,
      prev: prev || null,
      tempWatchIds,
      badgeOnly,
      evidence,
    },
  })
  if (!saved.ok) return { ok: false, error: saved.error }
  // Record event for timeline
  try {
    await recordBenchEvent(
      home,
      room.cwd,
      {
        action: 'focus',
        ok: true,
        summary: `聚焦 ${
          nextReq.visualizationId
            ? `组件 ${rt.visualization?.name || nextReq.visualizationId}`
            : [nextReq.connectionId, nextReq.deviceId, nextReq.pointId, nextReq.frameId].filter(Boolean).join('/') ||
              '未知目标'
        }`,
      },
      { source: origin.source, sessionId: origin.sessionId },
    )
  } catch {}
  return {
    ok: true,
    sessionId,
    focus: nextReq,
    prev,
    tempWatchIds,
    badgeOnly,
    evidence,
    configVersion: pack.configVersion || 1,
  }
}
