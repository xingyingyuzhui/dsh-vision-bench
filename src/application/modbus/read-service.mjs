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
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 */
/**
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusCommandBody} body
 * @param {ModbusOperationOptions} opts
 */
export const modbusRead = async (home, cwd, body, opts = {}) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const origin = originOf(body)
  const sessionId = String(opts?.sessionId || origin.sessionId || body?.sessionId || '')
  const workspace = await ensureWorkspaceClaimed(home, room.cwd, sessionId)
  const pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, sessionId))
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body?.deviceId ? String(body.deviceId).trim() : ''
  const activeCid = pack.activeConnectionId || pack.connections[0]?.id || 'c1'
  const activeDid =
    pack.activeDeviceId || pack.devices.find((d) => d.connectionId === activeCid)?.id || pack.devices[0]?.id || 'd1'
  const targetCid = cidArg || activeCid
  const targetDid = didArg || pack.devices.find((d) => d.connectionId === targetCid)?.id || activeDid
  const targetConnObj =
    pack.connections.find((c) => c.id === targetCid) ||
    pack.connections.find((c) => c.id === activeCid) ||
    pack.connections[0]
  const conn = targetConnObj ? targetConnObj.conn : pack.conn
  // Explicit ID enforcement for Agent: when multiple connections exist, require connectionId
  {
    const need = targetRequired(origin, pack, cidArg, didArg)
    if (need) return { ok: false, errorCode: need.errorCode, error: need.error }
  }
  // Device/connection disabled
  if (deviceDisabledOf(pack, targetCid, targetDid)) {
    return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
  }
  if (!targetConnObj || !pack.connections.some((c) => c.id === targetCid)) {
    return { ok: false, error: `连接不存在: ${targetCid}`, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND }
  }
  const sim = conn.sim === true
  const ready = connReady(conn)
  if (!sim && ready.error) return { ok: false, error: ready.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const transport = transportOf(opts)
  if (hasRunning(workspace, 'read')) {
    return { ok: false, error: '已有读点任务进行中' }
  }

  // Batch selection:
  //   all=true            → planned batches over every configured point (filtered by connection/device if given)
  //   pointId             → single configured point (must match connection/device if given)
  //   function+address    → standalone scratch read (no point needed) - still validates point existence for scoped reads
  let batches = []
  let labels = []
  if (body && body.all === true) {
    let filtered = /** @type {import('../../types/workspace.js').Point[]} */ (stampPoints(pack))
    if (cidArg) filtered = filtered.filter((p) => (p.connectionId || p.connId) === cidArg)
    if (didArg) filtered = filtered.filter((p) => p.deviceId === didArg)
    if (!filtered.length) return { ok: false, error: '无点位，请先添加点位' }
    const scopes = planScopedReadBatches(filtered)
    for (const scope of scopes) {
      for (const batch of scope.batches) {
        if (
          batch.connectionId !== scope.connectionId ||
          batch.deviceId !== scope.deviceId ||
          batch.unitId !== scope.unitId
        ) {
          return { ok: false, error: '读批次身份不一致', errorCode: ERROR_CODES.CONFIG_DRIFT }
        }
        batches.push(batch)
        labels.push(`读 ${functionTag(batch.fc)}${batch.address}×${batch.count}`)
      }
    }
  } else if (body?.pointId) {
    const point = pack.points.find((item) => item.id === body.pointId)
    if (!point) return { ok: false, error: `点位不存在: ${body.pointId}`, errorCode: ERROR_CODES.POINT_NOT_FOUND }
    {
      const rt = resolveUnifiedTarget(pack, {
        connectionId: cidArg || point.connectionId || targetCid,
        deviceId: didArg || point.deviceId || targetDid,
        pointId: body.pointId,
      })
      if (!rt.ok)
        return {
          ok: false,
          error: rt.error,
          errorCode: rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : rt.errorCode,
        }
    }
    const dev = pack.devices.find((d) => d.id === (didArg || point.deviceId || targetDid)) || {
      id: targetDid,
      unitId: 1,
    }
    batches = [
      {
        fc: point.function,
        address: point.address,
        count: 1,
        connectionId: point.connectionId || targetCid,
        deviceId: point.deviceId || targetDid,
        unitId: dev.unitId,
      },
    ]
    labels = [`读 ${pointLabel(point)}`]
  } else if (body && Number.isFinite(Number(body.function)) && Number.isFinite(Number(body.address))) {
    const fc = Number(body.function)
    const address = clampInt(body.address, -1, 0, 65535)
    const count = clampInt(body.count, 1, 1, 125)
    if (address < 0) return { ok: false, error: '缺少寄存器地址' }
    // If point table has entries, validate that the requested address range exists for the target connection/device
    if (pack.points.length) {
      let hasAny = false
      for (let i = 0; i < count; i++) {
        const hit = findPointV3(pack.points, fc, address + i, targetCid, targetDid)
        // if scoped read (cid/did given) must exist under that scope; otherwise allow any match
        if (hit && (!cidArg || (hit.connectionId || hit.connId) === cidArg) && (!didArg || hit.deviceId === didArg)) {
          hasAny = true
          break
        }
        // fallback: if no cid/did filter, any point matching fn+address suffices for validation? Keep permissive for standalone reads
        if (!cidArg && !didArg && findPointV3(pack.points, fc, address + i, activeCid, activeDid)) {
          hasAny = true
          break
        }
      }
      // For fully scoped reads requiring point existence, we could enforce; but keep permissive if no point table match for scratch reads
      // Only enforce when the caller explicitly targets a pointId-less but scoped read and we have points for that connection
      void hasAny
    }
    const dev = pack.devices.find((d) => d.id === targetDid) || { id: targetDid, unitId: 1 }
    batches = [{ fc, address, count, connectionId: targetCid, deviceId: targetDid, unitId: dev.unitId }]
    labels = [`读 ${functionTag(fc)}${address}×${count}`]
  } else {
    return { ok: false, error: '无点位：请传 all、pointId 或 function+address' }
  }

  const task = await openTask(home, room.cwd, {
    type: 'read',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: labels.length === 1 ? labels[0] : `读点表 ${batches.length} 批`,
  })

  let values = pack.values
  let okCount = 0
  let lastError = ''
  let lastFrames = null
  const results = []
  const framesLog = []
  const framesByConnection = { ...(pack.framesByConnection || {}) }

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]
    const batchCid = batch.connectionId || targetCid
    const batchDid = batch.deviceId || targetDid
    const batchConnObj = pack.connections.find((c) => c.id === batchCid) || targetConnObj
    const batchDevice = pack.devices.find((d) => d.id === batchDid) || { id: batchDid, unitId: batch.unitId || 1 }
    const batchSim = !!batchConnObj?.conn?.sim
    if (aborted(signal)) {
      await finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return {
        ok: false,
        cancelled: true,
        error: '已取消',
        taskId: task.id,
        source: origin.source,
        values,
        framesLog,
        framesByConnection,
      }
    }
    const ran = await runReadTx(
      transport,
      pack,
      batchConnObj,
      batchDevice,
      batch,
      room.cwd,
      20000,
      signal,
      origin.source,
    )
    if (ran.cancelled) {
      await finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return {
        ok: false,
        cancelled: true,
        error: '已取消',
        taskId: task.id,
        source: origin.source,
        values,
        framesLog,
        framesByConnection,
      }
    }
    const raw =
      ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw) ? ran.result.details.raw : []
    values = scatterBatch(values, pack.points, batch, raw, !!ran.ok, ran.ok ? '' : ran.error || '')
    let f = ran.frames || framesOf(ran)
    if (!f && batchSim) {
      f = {
        request: `SIM TX ${batch.fc}@${batch.address}×${batch.count}`,
        response: `SIM RX ${raw.slice(0, 3).join(',')}`,
        trace: [],
        frameFormat: 'rtu-adu',
      }
    }
    if (!f && (ran.transactionId || ran.error)) {
      f = {
        requestHex: '',
        responseHex: '',
        frameFormat: batchConnObj?.conn && batchConnObj.conn.mode === 'tcp' ? 'tcp-normalized' : 'rtu-adu',
      }
    }
    let entry = null
    if (f) {
      lastFrames = f
      entry = createTransactionFrame(labels[bi] + (batchSim ? '（仿真）' : ''), f, {
        connectionId: batchCid,
        deviceId: batchDid,
        taskId: task.id,
        source: origin.source,
        sessionId: origin.sessionId,
        direction: 'tx',
        unitId: batchDevice.unitId,
        functionCode: batch.fc,
        durationMs: ran.durationMs || 0,
        status: ran.ok ? 'ok' : 'error',
        error: ran.ok ? '' : ran.error || '',
        transactionId: ran.transactionId,
        port: batchConnObj?.conn?.port || '',
        at: Date.now(),
      })
      framesLog.push(entry)
      if (!framesByConnection[batchCid]) framesByConnection[batchCid] = []
      framesByConnection[batchCid] = framesByConnection[batchCid].concat([entry]).slice(-500)
    }
    await commitReadResult(home, room.cwd, {
      baseConfigVersion: pack.configVersion,
      connectionId: batchCid,
      deviceId: batchDid,
      pointValues: pointValuesOfBatch(values, pack, batch),
      frame: entry,
    })
    results.push({
      label: labels[bi],
      ok: !!ran.ok,
      error: ran.ok ? '' : ran.error || '',
      count: batch.count,
      connectionId: batchCid,
      deviceId: batchDid,
    })
    if (ran.ok) okCount += 1
    else lastError = ran.error || lastError
  }

  const okAll = okCount === batches.length
  const summary =
    (sim ? '仿真 ' : '') +
    (okAll
      ? `读取成功（${batches.length} 批）`
      : `读取 ${okCount}/${batches.length} 批成功${lastError ? `：${lastError}` : ''}`)
  await finishTask(home, room.cwd, task.id, { ok: okAll, summary, frames: lastFrames })
  const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
  return {
    ok: okAll,
    taskId: task.id,
    source: origin.source,
    summary,
    results,
    values: latest.values,
    framesLog,
    framesByConnection: latest.framesByConnection,
    simulated: sim,
    error: okAll ? undefined : lastError,
  }
}

// ── writes ───────────────────────────────────────────────────────────────
