// @ts-check
import { aborted, hasRunning, originOf, signalOf } from '../../domain/modbus/journal-model.mjs'
import { notifyBenchEvent } from '../../infrastructure/host/notify.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { clampInt, functionTag, normalizeWriteValues } from '../../domain/modbus/point-model.mjs'
import { recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { ensureWorkspaceClaimed, modbusForSession } from './workspace-session-view.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from './target-resolver-service.mjs'
import { endpointFingerprint, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3 } from '../../domain/modbus/function-code.mjs'
import { deviceDisabledOf, targetRequired } from '../../domain/modbus/validation.mjs'
import { entryLabel, writeLocks } from './modbus-runtime-context.mjs'
import { createPendingWrite, restorePendingWrite, takePendingWrite } from './write-approval-service.mjs'
import { executeApprovedWrite } from './write-execute.mjs'

/**
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 * @typedef {{ configVersion?: number, pointIds?: string[], endpoint?: object }} ApprovedWriteExpectation
 */

/**
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusCommandBody} body
 * @param {ModbusOperationOptions} opts
 */
export const modbusWrite = async (home, cwd, body, opts = {}) => {
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
  if (writeLocks.has(room.cwd) || hasRunning(workspace, 'write')) {
    return { ok: false, errorCode: ERROR_CODES.WRITE_BUSY, error: '已有写入任务进行中' }
  }
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
  const rawExpected = opts && opts.expected
  /** @type {ApprovedWriteExpectation | null} */
  const expected =
    rawExpected && typeof rawExpected === 'object' ? /** @type {ApprovedWriteExpectation} */ (rawExpected) : null
  if (expected) {
    const expectedVersion = Number(expected.configVersion)
    if (expectedVersion > 0 && (pack.configVersion || 1) !== expectedVersion) {
      return {
        ok: false,
        errorCode: ERROR_CODES.CONFIG_DRIFT,
        error: `配置版本已漂移（v${expectedVersion}→v${pack.configVersion || 1}），原批准已失效，请让 Agent 重新发起请求`,
      }
    }
    const expectedIds = Array.isArray(expected.pointIds) ? expected.pointIds.map((id) => String(id)) : null
    if (
      expectedIds &&
      (expectedIds.length !== targetPointIds.length || expectedIds.some((id, index) => id !== targetPointIds[index]))
    ) {
      return {
        ok: false,
        errorCode: ERROR_CODES.CONFIG_DRIFT,
        error: '点表在批准前发生了变化，原批准已失效，请让 Agent 重新发起请求',
      }
    }
    const devForExpected = pack.devices.find((item) => item.id === targetDid)
    if (expected.endpoint && !sameEndpoint(endpointFingerprint(conn, devForExpected), expected.endpoint)) {
      return {
        ok: false,
        errorCode: ERROR_CODES.ENDPOINT_DRIFT,
        error: '设备连接已变更，原批准已失效，请让 Agent 重新发起请求',
      }
    }
  }
  if (origin.source === 'agent' && !(body && body.confirm === true)) {
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
    request.label = entryLabel(fn, address, count, writeValues)
    return {
      ok: false,
      needsConfirm: true,
      requestId: request.id,
      request,
      error: 'Agent 写点是高影响操作，需要用户在界面上批准',
    }
  }

  writeLocks.add(room.cwd)
  try {
    return await executeApprovedWrite({
      home,
      roomCwd: room.cwd,
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
    })
  } finally {
    writeLocks.delete(room.cwd)
  }
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
  const sessionId = opts.sessionId ? String(opts.sessionId) : String(entry.params.sessionId || '')
  const workspace = await ensureWorkspaceClaimed(home, room.cwd, sessionId)
  const pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, sessionId))
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
  const wrote = await modbusWrite(
    home,
    room.cwd,
    {
      ...entry.params,
      source: 'agent',
      confirm: true,
    },
    {
      ...opts,
      expected: {
        configVersion: boundConfigVersion,
        pointIds: entry.params.pointIds,
        endpoint: entry.params.endpoint,
      },
    },
  )
  if (wrote && 'errorCode' in wrote && wrote.errorCode === ERROR_CODES.WRITE_BUSY) restorePendingWrite(entry)
  return wrote
}
