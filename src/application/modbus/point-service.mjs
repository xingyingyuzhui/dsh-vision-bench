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
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeFocusRequest, normalizeFocusState } from '../../infrastructure/store/focus-store.mjs'
import { ensureWorkspaceClaimed, modbusForSession, saveSessionModbusPatch } from './workspace-session-view.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from './target-resolver-service.mjs'
import { endpointFingerprint, endpointLabelText, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3, fnOfPoint } from '../../domain/modbus/function-code.mjs'
import { compactPointRow, isStaleValue } from '../../domain/modbus/point-value.mjs'
import { stampPoints } from '../../domain/modbus/unit-id.mjs'
import { connReady, deviceDisabledOf, pickConnPatch, targetRequired } from '../../domain/modbus/validation.mjs'
import { applyPointPatch, validateMonitorAlias } from '../../domain/modbus/point-patch.mjs'
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
  const sessionId = String(body?.sessionId || '')
  const workspace = await ensureWorkspaceClaimed(home, room.cwd, sessionId)
  const pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, sessionId))
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
    return {
      ok: true,
      action: 'points',
      configVersion: pack.configVersion || 1,
      points: list.map((p) => compactPointRow(p, pack.values)),
    }
  }
  if (op === 'add' || op === 'update') {
    const inputs = Array.isArray(body.points) ? body.points : body.point ? [body.point] : []
    if (!inputs.length) return { ok: false, error: '缺少 points 或 point' }
    /** @type {any[]} */
    const pending = []
    let planned = pack.points.slice()
    for (const input of inputs) {
      const rawIn = input && typeof input === 'object' ? input : {}
      const alias = validateMonitorAlias(rawIn)
      if (!alias.ok) return alias
      const inCid = rawIn.connectionId || rawIn.connId ? String(rawIn.connectionId || rawIn.connId).trim() : ''
      const inDid = rawIn.deviceId ? String(rawIn.deviceId).trim() : ''
      if (op === 'add') {
        const raw = { ...rawIn }
        raw.connectionId = inCid || targetConnId
        raw.deviceId = inDid || targetDevId
        const next = normalizePointV3(raw)
        if (!pack.connections.some((c) => c.id === next.connectionId)) next.connectionId = targetConnId
        if (!pack.devices.some((d) => d.id === next.deviceId)) next.deviceId = targetDevId
        if (planned.some((p) => p.id === next.id)) {
          return { ok: false, error: `点位已存在: ${pointLabel(next)}（可用 update 修改）` }
        }
        if (
          planned.some(
            (p) =>
              p.connectionId === next.connectionId &&
              p.deviceId === next.deviceId &&
              p.function === next.function &&
              p.address === next.address,
          )
        ) {
          return { ok: false, error: `点位已存在: ${pointLabel(next)}（可用 update 修改）` }
        }
        pending.push({ kind: 'add', next })
        planned = planned.concat([next])
      } else {
        const pid = rawIn.id ? String(rawIn.id).trim() : ''
        if (!pid) return { ok: false, error: '要更新的点位不存在: ' }
        const idx = planned.findIndex((p) => p.id === pid)
        if (idx < 0) return { ok: false, error: `要更新的点位不存在: ${pid}` }
        const existing = planned[idx]
        // Do not inject active connection/device into the patch — that falsely trips FROZEN checks.
        const patched = applyPointPatch(existing, rawIn)
        if (!patched.ok) return patched
        const merged = { ...existing, ...patched.point, id: existing.id }
        if (
          planned.some(
            (p, i) =>
              i !== idx &&
              p.connectionId === merged.connectionId &&
              p.deviceId === merged.deviceId &&
              p.function === merged.function &&
              p.address === merged.address,
          )
        ) {
          return { ok: false, error: `地址冲突: ${pointLabel(merged)}` }
        }
        pending.push({ kind: 'update', idx, point: merged })
        planned[idx] = merged
      }
    }
    let points = pack.points.slice()
    for (const step of pending) {
      if (step.kind === 'add') points = points.concat([step.next])
      else points[step.idx] = step.point
    }
    const saved = await saveSessionModbusPatch(home, room.cwd, sessionId, { modbus: { points, version: 3 } })
    if (!saved.ok) return saved
    const view = /** @type {ModbusWorkspace} */ (saved.view || modbusForSession(saved.workspace, sessionId))
    return {
      ok: true,
      action: 'points',
      points: view.points.map((p) => compactPointRow(p, view.values)),
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
    const saved = await saveSessionModbusPatch(home, room.cwd, sessionId, {
      modbus: { points: kept, values: keptValues, version: 3 },
    })
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
      const saved = await saveSessionModbusPatch(home, room.cwd, sessionId, {
        modbus: { points: kept, values: keptValues, version: 3 },
      })
      if (!saved.ok) return saved
      return { ok: true, action: 'points', cleared: true }
    }
    const saved = await saveSessionModbusPatch(home, room.cwd, sessionId, {
      modbus: { points: [], values: [], alarmActive: {}, alarmState: {}, version: 3 },
    })
    if (!saved.ok) return saved
    return { ok: true, action: 'points', cleared: true }
  }
  return { ok: false, error: 'op 必须是 list | add | update | remove | clear' }
}
