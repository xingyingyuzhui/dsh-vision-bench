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
  saveWorkspaceAsync,
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
export const pointsOp = async (home, cwd, body) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  const op = body?.op
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body?.deviceId ? String(body.deviceId).trim() : ''
  const targetConnId = cidArg || pack.activeConnectionId || ''
  const targetDevId =
    didArg || pack.devices.find((d) => d.connectionId === targetConnId)?.id || pack.activeDeviceId || ''
  if (op === 'list') {
    let list = pack.points
    if (cidArg) list = list.filter((p) => (p.connectionId || p.connId) === cidArg)
    if (didArg) list = list.filter((p) => p.deviceId === didArg)
    return { ok: true, action: 'points', points: list.map((p) => compactPointRow(p, pack.values)) }
  }
  if (op === 'add' || op === 'update') {
    const inputs = Array.isArray(body.points) ? body.points : body.point ? [body.point] : []
    if (!inputs.length) return { ok: false, error: '缺少 points 或 point' }
    let points = pack.points
    for (const input of inputs) {
      const raw = { ...(input || {}) }
      const inCid = raw.connectionId || raw.connId ? String(raw.connectionId || raw.connId).trim() : ''
      const inDid = raw.deviceId ? String(raw.deviceId).trim() : ''
      const connForPoint = inCid || targetConnId
      const devForPoint = inDid || targetDevId
      raw.connectionId = connForPoint
      raw.deviceId = devForPoint
      // normalize via v3 helper to ensure area/function/address correct
      const next = normalizePointV3(raw)
      // fix refs if invalid due to normalizePointV3 fallback logic
      if (!pack.connections.some((c) => c.id === next.connectionId)) next.connectionId = targetConnId
      if (!pack.devices.some((d) => d.id === next.deviceId)) next.deviceId = targetDevId
      if (op === 'add') {
        if (points.some((p) => p.id === next.id)) {
          return { ok: false, error: `点位已存在: ${pointLabel(next)}（可用 update 修改）` }
        }
        if (
          points.some(
            (p) =>
              p.connectionId === next.connectionId &&
              p.deviceId === next.deviceId &&
              p.function === next.function &&
              p.address === next.address,
          )
        ) {
          return { ok: false, error: `点位已存在: ${pointLabel(next)}（可用 update 修改）` }
        }
        points = points.concat([next])
      } else {
        const idx = points.findIndex((p) => p.id === next.id)
        if (idx < 0) return { ok: false, error: `要更新的点位不存在: ${next.id}` }
        // Task1/0.19.3 (P1 修复): 编辑不得改变归属 — 未显式给出 deviceId/connectionId 时
        // 保留原归属，绝不回落全局 activeDeviceId（会把设备2的点位移到设备1）
        const existing = points[idx]
        if (!inDid && !didArg) next.deviceId = existing.deviceId
        if (!inCid && !cidArg) next.connectionId = existing.connectionId
        // 未声明的新字段保留原值（监视/告警开关与上下限），显式值才修改
        if (raw.monitorEnabled === undefined && raw.trendEnabled === undefined)
          next.monitorEnabled = existing.monitorEnabled === true
        if (raw.alarmEnabled === undefined && raw.alarmMin === undefined && raw.alarmMax === undefined) {
          next.alarmEnabled = existing.alarmEnabled === true
          next.alarmMin = existing.alarmMin != null ? existing.alarmMin : null
          next.alarmMax = existing.alarmMax != null ? existing.alarmMax : null
        } else {
          if (raw.alarmMin === undefined) next.alarmMin = existing.alarmMin != null ? existing.alarmMin : null
          if (raw.alarmMax === undefined) next.alarmMax = existing.alarmMax != null ? existing.alarmMax : null
        }
        if (
          points.some(
            (p, i) =>
              i !== idx &&
              p.connectionId === next.connectionId &&
              p.deviceId === next.deviceId &&
              p.function === next.function &&
              p.address === next.address,
          )
        ) {
          return { ok: false, error: `地址冲突: ${pointLabel(next)}` }
        }
        points = points.map((p, i) => (i === idx ? { ...p, ...next, id: points[idx].id } : p))
      }
    }
    const saved = await saveWorkspaceAsync(home, room.cwd, { modbus: { points, version: 3 } })
    if (!saved.ok) return saved
    return {
      ok: true,
      action: 'points',
      points: /** @type {ModbusWorkspace} */ (saved.workspace.modbus).points.map((p) =>
        compactPointRow(p, saved.workspace.modbus.values),
      ),
    }
  }
  if (op === 'remove') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : body.id ? [String(body.id)] : []
    if (!ids.length) return { ok: false, error: '缺少 ids' }
    const idSet = new Set(ids)
    let kept = pack.points
    if (cidArg || didArg) {
      kept = kept.filter(
        (p) =>
          !(
            idSet.has(p.id) &&
            (!cidArg || (p.connectionId || p.connId) === cidArg) &&
            (!didArg || p.deviceId === didArg)
          ),
      )
    } else {
      kept = kept.filter((p) => !idSet.has(p.id))
    }
    const keptValues = (pack.values || []).filter((v) => {
      const k = v.key || v.pointId
      return !idSet.has(k) || !kept.some((p) => p.id === k)
    })
    if (kept.length === pack.points.length) return { ok: false, error: '没有匹配的点位' }
    const saved = await saveWorkspaceAsync(home, room.cwd, { modbus: { points: kept, values: keptValues, version: 3 } })
    if (!saved.ok) return saved
    return { ok: true, action: 'points', removed: ids.length }
  }
  if (op === 'clear') {
    if (cidArg || didArg) {
      const kept = pack.points.filter((p) => {
        if (cidArg && (p.connectionId || p.connId) !== cidArg) return true
        if (didArg && p.deviceId !== didArg) return true
        if (!cidArg && !didArg) return false
        // both filters matched => remove
        return false
      })
      const keptValues = (pack.values || []).filter((v) => {
        const k = v.key || v.pointId
        return kept.some((p) => p.id === k)
      })
      const saved = await saveWorkspaceAsync(home, room.cwd, {
        modbus: { points: kept, values: keptValues, version: 3 },
      })
      if (!saved.ok) return saved
      return { ok: true, action: 'points', cleared: true }
    }
    const saved = await saveWorkspaceAsync(home, room.cwd, {
      modbus: { points: [], values: [], alarmActive: {}, alarmState: {}, version: 3 },
    })
    if (!saved.ok) return saved
    return { ok: true, action: 'points', cleared: true }
  }
  return { ok: false, error: 'op 必须是 list | add | update | remove | clear' }
}
