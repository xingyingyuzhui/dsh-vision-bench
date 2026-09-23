// @ts-check
import { commitWriteResult } from './modbus-commit.mjs'
import { setPointValue } from '../../domain/modbus/point-model.mjs'
import { pointIdOf } from '../../domain/modbus/point-math.mjs'
import { finishTask, openTask } from '../../infrastructure/store/journal-store.mjs'
import { saveSessionModbusPatch } from './workspace-session-view.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3 } from '../../domain/modbus/function-code.mjs'
import { connReady } from '../../domain/modbus/validation.mjs'
import { toWriteRequest } from '../../infrastructure/modbus/transport-adapter.mjs'
import {
  createTransactionFrame,
  entryLabel,
  pointBefore,
  runReadTx,
  transportOf,
} from './modbus-runtime-context.mjs'

/**
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 * @typedef {import('../../types/modbus.js').WriteCompletionExtra} WriteCompletionExtra
 */

/**
 * Execute an already-validated write (sim or transport + readback).
 *
 * @param {{
 *   home: string,
 *   roomCwd: string,
 *   sessionId: string,
 *   pack: ModbusWorkspace,
 *   origin: { source: string, sessionId?: string },
 *   signal: AbortSignal | undefined,
 *   opts: ModbusOperationOptions,
 *   targetCid: string,
 *   targetDid: string,
 *   targetConnObj: any,
 *   conn: any,
 *   fn: number,
 *   address: number,
 *   writeValues: number[],
 *   count: number,
 *   check: { ok: boolean, values?: number[], fc?: number, error?: string },
 *   targetPointIds: string[],
 * }} ctx
 */
export async function executeApprovedWrite(ctx) {
  const {
    home,
    roomCwd,
    sessionId,
    pack,
    origin,
    signal,
    opts,
    targetCid,
    targetDid,
    targetConnObj,
    conn,
    fn,
    address,
    writeValues,
    count,
    check,
    targetPointIds,
  } = ctx

  const ready = connReady(conn)
  if (!conn.sim && ready.error) return { ok: false, error: ready.error }
  const transport = transportOf(opts)
  const label = entryLabel(fn, address, count, writeValues)
  /** @type {(number | null)[]} */
  const before = []
  for (let i = 0; i < count; i++) before.push(pointBefore(pack, fn, address + i, targetCid, targetDid))
  const task = await openTask(home, roomCwd, {
    type: 'write',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: label,
  })
  let finished = false
  /**
   * @param {boolean} ok
   * @param {string} summaryText
   * @param {WriteCompletionExtra} [extra]
   */
  const done = async (ok, summaryText, extra = {}) => {
    finished = true
    await finishTask(home, roomCwd, task.id, {
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
    const logFrames =
      Array.isArray(extra.transactionFrames) && extra.transactionFrames.length
        ? extra.transactionFrames.filter(Boolean)
        : _entry
          ? [_entry]
          : []
    if (logFrames.length || (Array.isArray(extra.pointValues) && extra.pointValues.length)) {
      await commitWriteResult(home, roomCwd, {
        // Sim writes persist values first (may bump configVersion). Passing the
        // pre-save version would mark this commit as CONFIG_DRIFT and drop trend samples.
        ...(extra.simulated ? {} : { baseConfigVersion: pack.configVersion }),
        connectionId: targetCid,
        deviceId: targetDid,
        pointValues: extra.pointValues || [],
        frames: logFrames,
        frame: logFrames[0],
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
      framesLog: logFrames,
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

  try {
    if (conn.sim) {
      const at = Date.now()
      let vals = pack.values
      for (let i = 0; i < count; i++) {
        const addr = address + i
        const point = findPointV3(pack.points, fn, addr, targetCid, targetDid)
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
      const nextConns = pack.connections.map((c) => (c.id === targetCid ? { ...c, conn: { ...c.conn, sim: false } } : c))
      const saved = await saveSessionModbusPatch(home, roomCwd, sessionId, {
        modbus: { connections: nextConns, values: vals, version: 3 },
      })
      if (saved && saved.ok === false) {
        return done(false, saved.error || '仿真写入保存失败', { errorCode: saved.errorCode })
      }
      return done(true, `${label}（本地生效，回读一致）`, {
        values: vals,
        simulated: true,
        readback: writeValues.slice(),
        pointValues: vals.filter((rec) => targetPointIds.includes(rec.pointId || rec.key)),
      })
    }

    const writeReq = toWriteRequest({
      cwd: roomCwd,
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
      finished = true
      await finishTask(home, roomCwd, task.id, { cancelled: true, summary: '写入已取消' })
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
      roomCwd,
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
    const readbackStatus = !readbackOk ? 'error' : mismatch ? 'error' : 'ok'
    const readbackError = !readbackOk
      ? String(readbackRan.error || '回读失败')
      : mismatch
        ? `WRITE_READBACK_MISMATCH expected=${JSON.stringify(writeValues)} got=${JSON.stringify(raw)}`
        : ''
    const readbackFrame = createTransactionFrame(`回读 ${label}`, readbackRan.frames || {}, {
      connectionId: targetCid,
      deviceId: targetDid,
      taskId: task.id,
      source: origin.source,
      unitId: writeReq.unitId,
      functionCode: fn,
      durationMs: readbackRan.durationMs || 0,
      transactionId: `${writeFrame.transactionId}:readback`,
      status: readbackStatus,
      error: readbackError,
      at: Date.now(),
    })
    return done(readbackOk && !mismatch, summary, {
      values: vals,
      readback: readbackOk ? raw : [],
      frame: writeFrame,
      transactionFrames: [writeFrame, readbackFrame],
      frames: ran.frames || readbackRan.frames,
      transactionId: writeFrame.transactionId,
      durationMs: writeFrame.durationMs,
      pointValues: vals.filter((rec) => targetPointIds.includes(rec.pointId || rec.key)),
      readbackOk,
      readbackTried: true,
      readbackMismatch: !!mismatch,
      errorCode: !readbackOk ? ERROR_CODES.STALE_VALUE : mismatch ? ERROR_CODES.WRITE_READBACK_MISMATCH : undefined,
    })
  } finally {
    if (!finished) await finishTask(home, roomCwd, task.id, { ok: false, summary: '写入中断' })
  }
}
