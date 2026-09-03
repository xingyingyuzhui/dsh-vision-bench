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
import { createPendingWrite, takePendingWrite } from './write-approval-service.mjs'
/**
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 * @typedef {import('../../types/modbus.js').WriteCompletionExtra} WriteCompletionExtra
 */
/**
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusCommandBody} body
 * @param {ModbusOperationOptions} opts
 */
export const modbusWrite = async (home, cwd, body, opts) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body?.deviceId ? String(body.deviceId).trim() : ''
  const targetCid = cidArg || pack.activeConnectionId || pack.connections[0]?.id || 'c1'
  const targetDid =
    didArg ||
    pack.devices.find((d) => d.connectionId === targetCid)?.id ||
    pack.activeDeviceId ||
    pack.devices[0]?.id ||
    'd1'
  const targetConnObj =
    pack.connections.find((c) => c.id === targetCid) ||
    pack.connections.find((c) => c.id === pack.activeConnectionId) ||
    pack.connections[0]
  const conn = targetConnObj ? targetConnObj.conn : pack.conn
  const origin = originOf(body)
  // Agent explicit ID enforcement & device disabled
  {
    const need = targetRequired(origin, pack, cidArg, didArg)
    if (need) return { ok: false, errorCode: need.errorCode, error: need.error }
  }
  if (deviceDisabledOf(pack, targetCid, targetDid)) {
    return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
  }
  if (!targetConnObj || !pack.connections.some((c) => c.id === targetCid)) {
    return { ok: false, error: `连接不存在: ${targetCid}`, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND }
  }
  const fn = Number(body?.function)
  const address = clampInt(body?.address, -1, 0, 65535)
  if (address < 0) return { ok: false, error: '缺少寄存器地址', errorCode: ERROR_CODES.TARGET_REQUIRED }
  const rawValues =
    body && body.values !== undefined ? body.values : body && body.value !== undefined ? body.value : undefined
  const check = normalizeWriteValues(fn, rawValues, 1968)
  if (!check.ok) return { ok: false, error: check.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const writeValues = Array.isArray(check.values) ? check.values : []
  const count = writeValues.length
  if (hasRunning(workspace, 'write')) {
    return { ok: false, error: '已有写入任务进行中' }
  }
  // Validate that every target address exists in the point table (v3-aware, scoped by connection/device)
  /** @type {string[]} */
  const targetPointIds = []
  for (let i = 0; i < count; i++) {
    const addr = address + i
    const hit = findPointV3(pack.points, fn, addr, targetCid, targetDid)
    if (!hit) {
      return { ok: false, error: `不在点表：${functionTag(fn)}${addr}`, errorCode: ERROR_CODES.POINT_NOT_FOUND }
    }
    {
      const rt = resolveUnifiedTarget(pack, {
        connectionId: cidArg || hit.connectionId || targetCid,
        deviceId: didArg || hit.deviceId || targetDid,
        pointId: hit.id,
      })
      if (!rt.ok)
        return {
          ok: false,
          error: rt.error,
          errorCode: rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : rt.errorCode,
        }
    }
    targetPointIds.push(hit.id)
  }
  if (origin.source === 'agent' && !(body && body.confirm === true)) {
    // §16.5-31: the confirmation card binds connection, device, points, config
    // version and the endpoint fingerprint so approval can re-validate all of them.
    const devForWrite = pack.devices.find((d) => d.id === targetDid)
    const request = createPendingWrite(room.cwd, {
      function: fn,
      address,
      values: writeValues.slice(),
      label: '',
      sessionId: origin.sessionId,
      connectionId: targetCid,
      connId: targetCid,
      deviceId: targetDid,
      pointIds: targetPointIds.slice(),
      endpoint: { ...endpointFingerprint(conn, devForWrite), configVersion: pack.configVersion || 1 },
    })
    // Label needs the tag helpers; fill it in place.
    request.label = entryLabel(fn, address, count, writeValues)
    return {
      ok: false,
      needsConfirm: true,
      requestId: request.id,
      request,
      error: 'Agent 写点是高影响操作，需要用户在界面上批准',
    }
  }
  const ready = connReady(conn)
  if (!conn.sim && ready.error) return { ok: false, error: ready.error }
  const transport = transportOf(opts)
  const label = entryLabel(fn, address, count, writeValues)
  /** @type {(number | null)[]} */
  const before = []
  for (let i = 0; i < count; i++) before.push(pointBefore(pack, fn, address + i, targetCid, targetDid))
  const task = await openTask(home, room.cwd, {
    type: 'write',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: label,
  })
  /**
   * @param {boolean} ok
   * @param {string} summaryText
   * @param {WriteCompletionExtra} [extra]
   */
  const done = async (ok, summaryText, extra = {}) => {
    await finishTask(home, room.cwd, task.id, {
      ok,
      summary: summaryText,
      frames: extra.frames || null,
    })
    const frameForLog =
      extra.frame ||
      extra.frames ||
      (extra.simulated
        ? {
            request: `SIM TX ${fn}@${address}×${count}`,
            response: `SIM RX ${extra.readback ? extra.readback.join(',') : ''}`,
            trace: [],
            frameFormat: 'rtu-adu',
          }
        : null)
    const devForWrite = pack.devices.find((d) => d.id === targetDid) || { unitId: 1 }
    const _entry =
      extra.frame ||
      (frameForLog
        ? createTransactionFrame(label, frameForLog, {
            connectionId: targetCid,
            deviceId: targetDid,
            taskId: task.id,
            source: origin.source,
            direction: 'tx',
            unitId: devForWrite.unitId,
            functionCode: fn,
            durationMs: extra.durationMs || 0,
            status: ok ? 'ok' : 'error',
            error: ok ? '' : extra.error || summaryText,
            transactionId: extra.transactionId,
            at: extra.at || Date.now(),
          })
        : null)
    if (_entry) {
      await commitWriteResult(home, room.cwd, {
        baseConfigVersion: pack.configVersion,
        connectionId: targetCid,
        deviceId: targetDid,
        pointValues: extra.pointValues || [],
        frame: _entry,
      })
    }
    const errorCode =
      extra.errorCode ||
      (!ok
        ? extra.readbackMismatch
          ? ERROR_CODES.WRITE_READBACK_MISMATCH
          : !extra.readbackOk && extra.readbackTried
            ? ERROR_CODES.STALE_VALUE
            : undefined
        : undefined)
    return {
      ok,
      taskId: task.id,
      source: origin.source,
      action: 'write',
      summary: summaryText,
      function: fn,
      address,
      connectionId: targetCid,
      connId: targetCid,
      deviceId: targetDid,
      before,
      target: writeValues,
      readback: extra.readback || [],
      frames: extra.frames || null,
      framesLog: _entry ? [_entry] : [],
      framesByConnection: extra.framesByConnection || undefined,
      values: extra.values || pack.values,
      simulated: !!extra.simulated,
      ...(ok ? {} : { error: summaryText, errorCode }),
      ...(errorCode ? { errorCode } : {}),
      ...(extra.outcomeUnknown
        ? {
            outcomeUnknown: true,
            retryable: false,
            transportErrorCode: extra.transportErrorCode || 'MODBUS_TIMEOUT',
          }
        : {}),
    }
  }

  if (conn.sim) {
    const at = Date.now()
    let vals = pack.values
    for (let i = 0; i < count; i++) {
      const addr = address + i
      const point = findPointV3(pack.points, fn, addr, targetCid, targetDid)
      // validation already ensures point exists, but keep fallback for safety
      const target = point || {
        id: pointIdOf(fn, addr),
        function: fn,
        address: addr,
        scale: 1,
        offset: 0,
        connectionId: targetCid,
        deviceId: targetDid,
      }
      vals = setPointValue(vals, target, writeValues[i], { ok: true, at })
    }
    // Persist values and exit sim (local write is considered verified) - need to target correct connection's sim flag
    const nextConns = pack.connections.map((c) => (c.id === targetCid ? { ...c, conn: { ...c.conn, sim: false } } : c))
    await saveWorkspaceAsync(home, room.cwd, { modbus: { connections: nextConns, values: vals, version: 3 } })
    return done(true, `${label}（本地生效，回读一致）`, {
      values: vals,
      simulated: true,
      readback: writeValues.slice(),
      pointValues: vals.filter((rec) => targetPointIds.includes(rec.pointId || rec.key)),
    })
  }

  const writeReq = toWriteRequest({
    cwd: room.cwd,
    connection: targetConnObj,
    device: pack.devices.find((d) => d.id === targetDid) || { id: targetDid, unitId: 1 },
    point: { address, function: fn },
    values: writeValues,
    timeoutMs: 20000,
    configVersion: pack.configVersion,
    fc: check.fc,
    source: origin.source,
  })
  const ran = await transport.write(writeReq, { signal, sim: false })
  if (ran?.error && ran.error.code === 'CANCELLED') {
    await finishTask(home, room.cwd, task.id, { cancelled: true, summary: '写入已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  if (!ran || ran.ok === false) {
    const frames = ran?.frames
    const code = ran?.error?.code
    if (code === 'MODBUS_TIMEOUT') {
      return done(false, '写入响应超时，设备是否已执行未知；请先读取回读值，不要直接重试', {
        frames,
        frame: createTransactionFrame(label, frames || {}, {
          connectionId: targetCid,
          deviceId: targetDid,
          taskId: task.id,
          source: origin.source,
          unitId: writeReq.unitId,
          functionCode: check.fc,
          durationMs: ran?.durationMs || 0,
          transactionId: ran?.transactionId,
          status: 'error',
          error: 'WRITE_OUTCOME_UNKNOWN',
          at: Date.now(),
        }),
        transactionId: ran?.transactionId,
        durationMs: ran?.durationMs,
        errorCode: ERROR_CODES.WRITE_OUTCOME_UNKNOWN,
        transportErrorCode: 'MODBUS_TIMEOUT',
        outcomeUnknown: true,
        retryable: false,
      })
    }
    return done(false, `写入失败 ${(ran?.error?.message) || (ran?.error) || ''}`, {
      frames,
      frame:
        frames || ran?.transactionId
          ? createTransactionFrame(label, frames || {}, {
              connectionId: targetCid,
              deviceId: targetDid,
              taskId: task.id,
              source: origin.source,
              unitId: writeReq.unitId,
              functionCode: check.fc,
              durationMs: ran?.durationMs || 0,
              transactionId: ran?.transactionId,
              status: 'error',
              error: ran?.error?.message || '',
              at: Date.now(),
            })
          : null,
      transactionId: ran?.transactionId,
      durationMs: ran?.durationMs,
      errorCode: code || ERROR_CODES.TARGET_REQUIRED,
    })
  }
  const writeFrame = createTransactionFrame(label, ran.frames || {}, {
    connectionId: targetCid,
    deviceId: targetDid,
    taskId: task.id,
    source: origin.source,
    unitId: writeReq.unitId,
    functionCode: check.fc,
    durationMs: ran.durationMs || 0,
    transactionId: ran.transactionId,
    status: 'ok',
    at: Date.now(),
  })
  const readbackRan = await runReadTx(
    transport,
    pack,
    targetConnObj,
    pack.devices.find((d) => d.id === targetDid) || { id: targetDid, unitId: writeReq.unitId },
    { fc: fn, address, count, connectionId: targetCid, deviceId: targetDid },
    room.cwd,
    20000,
    signal,
  )
  const raw =
    readbackRan.ok && readbackRan.result && readbackRan.result.details && Array.isArray(readbackRan.result.details.raw)
      ? readbackRan.result.details.raw.slice(0, count)
      : []
  const readbackOk = readbackRan.ok && raw.length === count
  let vals = pack.values
  for (let i = 0; i < count; i++) {
    const addr = address + i
    const pseudo = findPointV3(pack.points, fn, addr, targetCid, targetDid) || {
      id: pointIdOf(fn, addr),
      function: fn,
      address: addr,
      scale: 1,
      offset: 0,
      connectionId: targetCid,
      deviceId: targetDid,
    }
    vals = setPointValue(vals, pseudo, raw[i] !== undefined ? raw[i] : null, {
      ok: readbackOk,
      error: readbackOk ? '' : readbackRan.error || '',
    })
  }
  const mismatch = readbackOk && raw.some((value, i) => Number(value) !== Number(writeValues[i]))
  const summary =
    label +
    (readbackOk
      ? mismatch
        ? `，回读不一致：${JSON.stringify(raw)}`
        : '，回读一致'
      : `，回读失败 ${readbackRan.error || ''}`)
  // persist values immediately for readback
  return done(readbackOk && !mismatch, summary, {
    values: vals,
    readback: readbackOk ? raw : [],
    frame: writeFrame,
    frames: ran.frames || readbackRan.frames,
    transactionId: writeFrame.transactionId,
    durationMs: writeFrame.durationMs,
    pointValues: vals.filter((rec) => targetPointIds.includes(rec.pointId || rec.key)),
    readbackOk,
    readbackTried: true,
    readbackMismatch: !!mismatch,
    errorCode: !readbackOk ? ERROR_CODES.STALE_VALUE : mismatch ? ERROR_CODES.WRITE_READBACK_MISMATCH : undefined,
  })
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {string} id
 * @param {boolean} approved
 * @param {ModbusOperationOptions & { sessionId?: string }} [opts]
 */
export const resolvePendingWrite = async (home, cwd, id, approved, opts = {}) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  // Ownership is checked before the entry is consumed: a foreign or anonymous
  // caller must neither write, reject, nor evict the owner's request.
  const taken = takePendingWrite(room.cwd, id, opts.sessionId ? String(opts.sessionId) : '')
  if (!taken.ok) return { ok: false, error: taken.error, errorCode: taken.errorCode }
  const entry = taken.entry
  if (approved !== true) {
    await recordBenchEvent(
      home,
      room.cwd,
      {
        action: 'write-reject',
        ok: false,
        summary: `拒绝 Agent 写点：${entry.params.label}`,
      },
      { source: 'user' },
    )
    void notifyBenchEvent(home, room.cwd, `用户拒绝了写点请求：${entry.params.label}`, '', {
      sessionId: entry.params.sessionId,
    }).catch(() => {})
    return { ok: true, rejected: true }
  }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  const cid = entry.params.connectionId || entry.params.connId || pack.activeConnectionId
  const connForWrite = pack.connections.find((c) => c.id === cid)?.conn || pack.conn
  const devForWrite = (pack.devices || []).find((d) => d.id === entry.params.deviceId)
  if (!sameEndpoint(endpointFingerprint(connForWrite, devForWrite), entry.params.endpoint)) {
    await recordBenchEvent(
      home,
      room.cwd,
      {
        action: 'write-stale',
        ok: false,
        summary: `写点请求过期（连接已变更）：${entry.params.label}`,
      },
      { source: 'system' },
    )
    void notifyBenchEvent(home, room.cwd, '写点请求已失效：串口/TCP 连接在批准前发生了变化，请让 Agent 重新发起', '', {
      sessionId: entry.params.sessionId,
    }).catch(() => {})
    return {
      ok: false,
      error: '设备连接已变更，原批准已失效，请让 Agent 重新发起请求',
      errorCode: ERROR_CODES.ENDPOINT_DRIFT,
    }
  }
  const boundConfigVersion = Number(entry.params.endpoint?.configVersion)
  if (boundConfigVersion > 0 && (pack.configVersion || 1) !== boundConfigVersion) {
    await recordBenchEvent(
      home,
      room.cwd,
      {
        action: 'write-stale',
        ok: false,
        summary: `写点请求过期（配置版本已漂移 v${boundConfigVersion}→v${pack.configVersion || 1}）：${entry.params.label}`,
      },
      { source: 'system' },
    )
    void notifyBenchEvent(home, room.cwd, '写点请求已失效：配置在批准前发生了变化，请让 Agent 重新发起', '', {
      sessionId: entry.params.sessionId,
    }).catch(() => {})
    return {
      ok: false,
      error: `配置版本已漂移（v${boundConfigVersion}→v${pack.configVersion || 1}），原批准已失效，请让 Agent 重新发起请求`,
      errorCode: ERROR_CODES.CONFIG_DRIFT,
    }
  }
  return modbusWrite(
    home,
    room.cwd,
    {
      ...entry.params,
      source: 'agent',
      confirm: true,
    },
    opts,
  )
}
