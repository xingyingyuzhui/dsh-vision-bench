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

/**
 * @typedef {import('../../types/modbus.js').CapturedFrames} CapturedFrames
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusTransport} ModbusTransport
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 * @typedef {import('../../types/modbus.js').ReadBatch} ReadBatch
 * @typedef {import('../../types/modbus.js').TransactionFrameExtra} TransactionFrameExtra
 * @typedef {import('../../types/modbus.js').TransportResult} TransportResult
 * @typedef {import('../../types/workspace.js').Connection} Connection
 * @typedef {import('../../types/workspace.js').Device} Device
 * @typedef {import('../../types/workspace.js').PointValue} PointValue
 */

export { ERROR_CODES, isStaleValue, pickConnPatch }

/** @param {ModbusOperationOptions | undefined} opts @returns {ModbusTransport} */
export const transportOf = (opts) => opts?.transport || createModbusTransport()

/** @type {Map<string, unknown>} */
export const pollLocks = new Map()
export const POLL_BUDGET_MS = 30000

export const PENDING_TTL_MS = 5 * 60 * 1000
/** @type {Map<string, { id: string, cwd: string, createdAt: number, params: ModbusCommandBody }>} */
export const pendingWrites = new Map()
export const pendingState = { seq: 0 }

export const prunePendingWrites = () => {
  const now = Date.now()
  for (const [key, entry] of pendingWrites) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingWrites.delete(key)
  }
}

/** @param {ModbusCommandBody | undefined | null} ran */
export const framesOf = (ran) => {
  const details = ran?.result?.details
  const frames = details && typeof details.frames === 'object' ? details.frames : null
  if (!frames) return null
  return {
    request: typeof frames.request === 'string' ? frames.request.slice(0, 200) : '',
    response: typeof frames.response === 'string' ? frames.response.slice(0, 200) : '',
    trace: Array.isArray(frames.trace)
      ? frames.trace.map((/** @type {unknown} */ line) => String(line).slice(0, 200)).slice(0, 8)
      : [],
  }
}

/**
 * @param {string} label
 * @param {CapturedFrames | null | undefined} frames
 * @param {TransactionFrameExtra} [extra]
 */
export const createTransactionFrame = (label, frames, extra = {}) => {
  const at = Number(extra.at) || Date.now()
  const cid = String(extra.connectionId || '')
  const did = String(extra.deviceId || '')
  const tid = String(extra.taskId || '')
  const txId = String(extra.transactionId || extra.frameId || `${cid}:${at}:${tid}`)
  const req = (frames && (frames.requestHex || frames.request)) || ''
  const res = (frames && (frames.responseHex || frames.response)) || ''
  return {
    id: txId,
    frameId: txId,
    transactionId: txId,
    t: at,
    at,
    connectionId: cid,
    deviceId: did,
    deviceName: String(extra.deviceName || ''),
    taskId: tid,
    sessionId: String(extra.sessionId || ''),
    toolCallId: String(extra.toolCallId || ''),
    port: String(extra.port || ''),
    source: String(extra.source || 'user'),
    direction: String(extra.direction || 'tx'),
    label,
    request: req,
    response: res,
    requestHex: String(req).slice(0, 400),
    responseHex: String(res).slice(0, 400),
    frameFormat: String(frames?.frameFormat || extra.frameFormat || ''),
    trace: frames && Array.isArray(frames.trace) ? frames.trace : [],
    unitId: Number.isFinite(Number(extra.unitId)) ? Math.trunc(Number(extra.unitId)) : 1,
    functionCode: Number.isFinite(Number(extra.functionCode)) ? Math.trunc(Number(extra.functionCode)) : 3,
    durationMs: Number.isFinite(Number(extra.durationMs)) ? Math.trunc(Number(extra.durationMs)) : 0,
    status: String(extra.status || 'ok').slice(0, 16),
    error: String(extra.error || '').slice(0, 200),
  }
}

export const frameEntry = createTransactionFrame

/**
 * @param {PointValue[]} values
 * @param {ModbusWorkspace} pack
 * @param {ReadBatch} batch
 */
export const pointValuesOfBatch = (values, pack, batch) => {
  const ids = new Set()
  for (const p of pack.points || []) {
    if (Number(p.function) !== Number(batch.fc)) continue
    if (Number(p.address) < batch.address || Number(p.address) >= batch.address + batch.count) continue
    if (batch.connectionId && (p.connectionId || p.connId) !== batch.connectionId) continue
    if (batch.deviceId && p.deviceId !== batch.deviceId) continue
    ids.add(p.id)
  }
  return (Array.isArray(values) ? values : []).filter((rec) => rec && ids.has(rec.pointId || rec.key))
}

// ── reads ────────────────────────────────────────────────────────────────

/**
 * @param {ModbusTransport} transport
 * @param {ModbusWorkspace} pack
 * @param {Connection} connObj
 * @param {Device} device
 * @param {ReadBatch} batch
 * @param {string} cwd
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 * @param {string} [source]
 */
export const runReadTx = async (transport, pack, connObj, device, batch, cwd, timeoutMs, signal, source) => {
  const req = toReadRequest({
    cwd,
    connection: connObj,
    device,
    batch,
    timeoutMs,
    configVersion: pack.configVersion,
    source,
  })
  const sim = !!connObj?.conn?.sim
  const ran = await transport.read(req, { signal, sim })
  if (ran && ran.ok === false) {
    return {
      ok: false,
      error: ran.error?.message || String(ran.error || ''),
      errorCode: ran.error?.code,
      cancelled: ran.error && ran.error.code === 'CANCELLED',
      frames: ran.frames,
      transactionId: ran.transactionId,
      durationMs: ran.durationMs,
    }
  }
  const raw = Array.isArray(ran.data) ? ran.data : ran.result?.details?.raw || []
  return {
    ok: true,
    result: { details: { raw } },
    frames: ran.frames,
    transactionId: ran.transactionId,
    durationMs: ran.durationMs,
  }
}

/**
 * @param {ModbusWorkspace | PointValue[]} packOrValues
 * @param {number} fn
 * @param {number} address
 * @param {string} [cid]
 * @param {string} [did]
 */
export const pointBefore = (packOrValues, fn, address, cid, did) => {
  // support both pack and legacy values array
  if (!Array.isArray(packOrValues)) {
    const pack = packOrValues
    const c = cid || pack.activeConnectionId
    const d = did || pack.activeDeviceId
    const point = findPointV3(pack.points, fn, address, c, d)
    if (!point) return null
    const rec = (Array.isArray(pack.values) ? pack.values : []).find(
      (item) => item && (item.key === point.id || item.pointId === point.id),
    )
    return rec && rec.raw !== null && rec.raw !== undefined ? rec.raw : null
  }
  const values = packOrValues
  const key = pointIdOf(fn, address)
  const rec = (Array.isArray(values) ? values : []).find((item) => item.key === key)
  return rec && rec.raw !== null && rec.raw !== undefined ? rec.raw : null
}

/** @param {number} fn @param {number} address @param {number} count @param {unknown[]} values */
export const entryLabel = (fn, address, count, values) =>
  count === 1
    ? `写 ${functionTag(fn)}${address} = ${values[0]}`
    : `批量写 ${functionTag(fn)}${address}–${address + count - 1}（${count} 点）`

// ── polling ──────────────────────────────────────────────────────────────

/** @param {ModbusCommandBody[]} items @param {string} kind */
export const alarmSummary = (items, kind) =>
  items
    .slice(0, 5)
    .map((item) => {
      const limit =
        kind === 'max' ? item.point.alarmMax : item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
      void limit
      return decodeValue(item.point, item.raw) !== undefined
        ? `${pointLabel(item.point)}=${decodeValue(item.point, item.raw)}`
        : pointLabel(item.point)
    })
    .join('；')

// Task1/0.19.3: 旧 `enabled=false`（参与运行开关）一次性迁移 — 停止该连接自动采集，
// 然后清理旧禁用字段，使 enabled 不再是公开概念（只保留读取兼容）。

/** @param {ModbusCommandBody} item @param {string} kind */
export const alarmLabel = (item, kind) => {
  const limit = kind === 'max' ? item.point.alarmMax : item.point.alarmMin
  return `${pointLabel(item.point)}=${decodeValue(item.point, item.raw)}${kind === 'max' ? `>${limit}` : `<${limit}`}`
}

// Legacy compat for old tests that pass device.segments

/** @param {ModbusCommandBody} device @param {ModbusCommandBody[]} values */
export function deviceAlarms(device, values) {
  if (device && Array.isArray(device.points)) {
    return evaluatePointAlarms(device.points, values, device.alarmActive)
  }
  // Old segment-based path
  const segs = Array.isArray(device?.segments) ? device.segments : []
  /** @type {Record<string, ModbusCommandBody>} */
  const byId = {}
  for (const s of segs) {
    const fn = Number(s.function)
    const addr = Number(s.address)
    const count = Number(s.count) || 1
    for (let i = 0; i < count; i++) {
      const key = `${s.id}:${fn}@${addr + i}`
      byId[key] = s
    }
  }
  /** @type {Record<string, boolean>} */
  const active = device?.alarmActive && typeof device.alarmActive === 'object' ? device.alarmActive : {}
  const next = { ...active }
  const fired = []
  const cleared = []
  for (const rec of Array.isArray(values) ? values : []) {
    if (!rec || !rec.key || rec.ok !== true) continue
    const seg = byId[rec.key] || segs.find((s) => s.id === rec.segmentId)
    if (!seg || (seg.alarmMin === null && seg.alarmMax === null)) continue
    const raw = rec.raw !== undefined ? rec.raw : rec.value
    const breach = evaluateAlarm(seg, raw)
    if (breach && !next[rec.key]) {
      next[rec.key] = true
      fired.push({
        seg,
        address: rec.address,
        value: raw,
        raw,
        kind: breach,
        point: { ...seg, address: rec.address, alarmMin: seg.alarmMin, alarmMax: seg.alarmMax },
      })
    } else if (!breach && next[rec.key]) {
      delete next[rec.key]
      cleared.push({ seg, address: rec.address, value: raw, raw })
    }
  }
  return { next, fired, cleared }
}

export const pickModbusPatch = pickConnPatch

export const _internal = {
  get deviceAlarms() {
    return deviceAlarms
  },
  evaluatePointAlarms,
  alarmLabel,
  endpointFingerprint,
}
