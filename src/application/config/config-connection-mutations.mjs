// @ts-check
import { validateConnections } from '../../../bench-devices.mjs'
import { explicitId } from '../../domain/config/config-operation.mjs'
import { resolveHierarchy } from '../../domain/modbus/target-resolver.mjs'
import { pickConnPatch } from '../../domain/modbus/validation.mjs'
import { idsOfPoints, scrubPointRuntime } from './config-point-mutations.mjs'

/**
 * @typedef {(home: string, cwd: string, opts?: object) => Promise<{ connectionStates?: object[] }> | { connectionStates?: object[] }} ListConnectionStates
 */

/**
 * @param {any} home
 * @param {any} cwd
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @param {ListConnectionStates} listStates
 * @returns {Promise<any>}
 */
export async function applyConnection(home, cwd, workspace, op, target, value, listStates) {
  const pack = workspace.modbus
  const id = explicitId(target.connectionId || value.connectionId || value.connId || value.id)
  if (op === 'create') {
    const nextId = id || `c${Date.now().toString(36)}`
    if (pack.connections.some((/** @type {any} */ c) => c.id === nextId)) {
      return { ok: false, error: `连接已存在: ${nextId}` }
    }
    const conn = {
      id: nextId,
      name: String(value.name || nextId).slice(0, 40),
      role: value.role === 'server' || value.role === 'slave' ? value.role : 'client',
      enabled: value.enabled !== false,
      conn: {
        mode: 'rtu',
        baudrate: 9600,
        bytesize: 8,
        parity: 'N',
        stopbits: 1,
        tcpPort: 502,
        sim: false,
        ...pickConnPatch(value.conn || value),
      },
    }
    pack.connections = pack.connections.concat([conn])
    const errs = validateConnections(pack.connections, pack.devices)
    if (errs.length) return { ok: false, errorCode: 'CONFIG_INVALID', error: errs.join('；') }
    return { ok: true, workspace, summary: `创建连接 ${nextId}`, changedIds: [nextId], connectionId: nextId }
  }
  if (op === 'remove') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 connectionId' }
    const hit = pack.connections.find((/** @type {any} */ c) => c.id === id)
    if (!hit) return { ok: false, errorCode: 'CONNECTION_NOT_FOUND', error: `连接不存在: ${id}` }
    const removedPoints = pack.points.filter((/** @type {any} */ p) => p.connectionId === id)
    pack.connections = pack.connections.filter((/** @type {any} */ c) => c.id !== id)
    pack.devices = pack.devices.filter((/** @type {any} */ d) => d.connectionId !== id)
    pack.points = pack.points.filter((/** @type {any} */ p) => p.connectionId !== id)
    scrubPointRuntime(pack, idsOfPoints(removedPoints))
    if (pack.activeConnectionId === id) {
      pack.activeConnectionId = pack.connections[0]?.id || ''
      pack.activeDeviceId =
        pack.devices.find((/** @type {any} */ d) => d.connectionId === pack.activeConnectionId)?.id || ''
    } else if (pack.activeDeviceId) {
      const still = pack.devices.find(
        (/** @type {any} */ d) => d.id === pack.activeDeviceId && d.connectionId === pack.activeConnectionId,
      )
      if (!still) {
        pack.activeDeviceId =
          pack.devices.find((/** @type {any} */ d) => d.connectionId === pack.activeConnectionId)?.id || ''
      }
    }
    if (pack.pollingByConnection) {
      const nextPoll = { ...pack.pollingByConnection }
      delete nextPoll[id]
      pack.pollingByConnection = nextPoll
    }
    if (pack.framesByConnection) {
      const nextFrames = { ...pack.framesByConnection }
      delete nextFrames[id]
      pack.framesByConnection = nextFrames
    }
    void cwd
    return {
      ok: true,
      workspace,
      summary: `删除连接 ${id}`,
      changedIds: [id],
      postCommit: { releaseConnectionIds: [id] },
    }
  }
  if (op === 'update') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 connectionId' }
    const hit = pack.connections.find((/** @type {any} */ c) => c.id === id)
    if (!hit) return { ok: false, error: `连接不存在: ${id}` }
    const patch = pickConnPatch(value.conn || value)
    if (Object.keys(patch).length) {
      const states = await listStates(home, cwd)
      /**
       * @param {any} s
       * @returns {any}
       */
      const live = /** @type {any} */ (
        (states.connectionStates || []).find((/** @type {any} */ s) => s.connectionId === id)
      )
      const busy =
        live && (live.status === 'connected' || live.status === 'connecting' || live.status === 'disconnecting')
      if (busy) {
        return { ok: false, errorCode: 'CONNECTION_BUSY', error: '修改已连接端点前请先断开' }
      }
    }
    pack.connections = pack.connections.map((/** @type {any} */ c) => {
      if (c.id !== id) return c
      return {
        ...c,
        name: value.name != null ? String(value.name).slice(0, 40) : c.name,
        enabled: value.enabled != null ? value.enabled !== false : c.enabled,
        conn: { ...c.conn, ...patch },
      }
    })
    const errs = validateConnections(pack.connections, pack.devices)
    if (errs.length) return { ok: false, errorCode: 'CONFIG_INVALID', error: errs.join('；') }
    return {
      ok: true,
      workspace,
      summary: `更新连接 ${id}`,
      changedIds: [id],
      connectionId: id,
      postCommit: { releaseConnectionIds: Object.keys(patch).length ? [id] : [] },
    }
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'connection op 必须是 create|update|remove' }
}

/**
 * @param {any} workspace
 * @param {any} op
 * @param {any} target
 * @param {any} value
 * @returns {any}
 */
export function applyDevice(workspace, op, target, value) {
  const pack = workspace.modbus
  const id = explicitId(target.deviceId || value.deviceId || value.id)
  const cid = explicitId(target.connectionId || value.connectionId || value.connId)
  if (op === 'create') {
    if (!cid) return { ok: false, errorCode: 'TARGET_REQUIRED', error: '创建设备必须携带 connectionId' }
    const nextId = id || `d${Date.now().toString(36)}`
    const unitId = Math.trunc(Number(value.unitId != null ? value.unitId : value.slave))
    pack.devices = pack.devices.concat([
      {
        id: nextId,
        connectionId: cid,
        name: String(value.name || nextId).slice(0, 40),
        unitId: Number.isFinite(unitId) ? unitId : 1,
        enabled: value.enabled !== false,
      },
    ])
    return { ok: true, workspace, summary: `添加设备 ${nextId}`, changedIds: [nextId], deviceId: nextId }
  }
  if (op === 'remove') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'remove 必须携带 deviceId' }
    const scoped = resolveHierarchy(pack, { connectionId: cid || undefined, deviceId: id })
    if (!scoped.ok) return scoped
    const removed = pack.devices.find((/** @type {any} */ d) => d.id === id)
    const removedPoints = pack.points.filter((/** @type {any} */ p) => p.deviceId === id)
    pack.devices = pack.devices.filter((/** @type {any} */ d) => d.id !== id)
    pack.points = pack.points.filter((/** @type {any} */ p) => p.deviceId !== id)
    scrubPointRuntime(pack, idsOfPoints(removedPoints))
    if (pack.activeDeviceId === id) {
      const connectionId = removed?.connectionId || pack.activeConnectionId
      pack.activeDeviceId = pack.devices.find((/** @type {any} */ d) => d.connectionId === connectionId)?.id || ''
    }
    return { ok: true, workspace, summary: `删除设备 ${id}`, changedIds: [id] }
  }
  if (op === 'update') {
    if (!id) return { ok: false, errorCode: 'TARGET_REQUIRED', error: 'update 必须携带 deviceId' }
    const hit = pack.devices.find((/** @type {any} */ d) => d.id === id)
    if (!hit) return { ok: false, error: `设备不存在: ${id}` }
    pack.devices = pack.devices.map((/** @type {any} */ d) => {
      if (d.id !== id) return d
      const unitArg = value.unitId != null ? value.unitId : value.slave
      const unitId = unitArg == null ? d.unitId : Math.trunc(Number(unitArg))
      return {
        ...d,
        name: value.name != null ? String(value.name).slice(0, 40) : d.name,
        unitId,
        enabled: value.enabled != null ? value.enabled !== false : d.enabled,
      }
    })
    return { ok: true, workspace, summary: `更新设备 ${id}`, changedIds: [id], deviceId: id }
  }
  return { ok: false, errorCode: 'UNKNOWN_OP', error: 'device op 必须是 create|update|remove' }
}
