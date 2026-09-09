import { evaluateAlarms } from './bench-alarm.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { workspaceRepository } from './bench-store.mjs'
import { sampleTrendValues } from './bench-trend-store.mjs'
import {
  normalizeSessionConfigs,
  unionScopedConnections,
  unionScopedDevices,
  unionScopedPoints,
} from './src/domain/modbus/config-scope.mjs'

const mergePointValues = (current, incoming) => {
  const byId = new Map()
  for (const rec of Array.isArray(current) ? current : []) {
    const id = rec && (rec.pointId || rec.key)
    if (id) byId.set(id, rec)
  }
  for (const rec of Array.isArray(incoming) ? incoming : []) {
    const id = rec && (rec.pointId || rec.key)
    if (!id) continue
    byId.set(id, rec)
  }
  return [...byId.values()]
}

const appendFrame = (map, connectionId, frame) => {
  const cid = String(connectionId || '')
  if (!cid || !frame) return map
  const next = { ...(map || {}) }
  const ring = Array.isArray(next[cid]) ? next[cid].slice() : []
  ring.push(frame)
  next[cid] = ring.slice(-500)
  return next
}

export const appendTransactionFrame = (home, cwd, frame) =>
  workspaceRepository(home).mutateRuntime(cwd, (ws) => {
    const pack = normalizeModbus(ws.modbus)
    const framesByConnection = appendFrame(pack.framesByConnection, frame && frame.connectionId, frame)
    return { workspace: { ...ws, modbus: { ...ws.modbus, framesByConnection, version: 3 } } }
  })

const commit = (home, cwd, input, kind) =>
  workspaceRepository(home).mutateRuntime(cwd, (ws) => {
    const pack = normalizeModbus(ws.modbus)
    const sessionConfigs = normalizeSessionConfigs(pack.sessionConfigs)
    const share = pack.share
    const points = unionScopedPoints(pack.points, sessionConfigs, share)
    const connections = unionScopedConnections(pack.connections, sessionConfigs, share)
    const devices = unionScopedDevices(pack.devices, sessionConfigs, share)
    const cid = String((input && input.connectionId) || '')
    const did = String((input && input.deviceId) || '')
    const connOk = !cid || connections.some((c) => c.id === cid)
    const devOk = !did || devices.some((d) => d.id === did)
    const drift =
      (input &&
        input.baseConfigVersion &&
        pack.configVersion &&
        Number(input.baseConfigVersion) !== Number(pack.configVersion)) ||
      !connOk ||
      !devOk
    let values = pack.values
    if (!drift && input && Array.isArray(input.pointValues) && input.pointValues.length) {
      const allowed = new Set(points.map((p) => p.id))
      const incoming = input.pointValues.filter((rec) => rec && allowed.has(rec.pointId || rec.key))
      values = mergePointValues(pack.values, incoming)
    }
    let framesByConnection = pack.framesByConnection
    if (input && input.frame) {
      const frame = drift ? { ...input.frame, status: 'error', error: 'CONFIG_DRIFT' } : input.frame
      if (!cid || connections.some((c) => c.id === cid) || drift) {
        framesByConnection = appendFrame(pack.framesByConnection, cid, frame)
      }
    }
    const alarmEval = evaluateAlarms({
      points,
      values,
      prevState: pack.alarmState || pack.alarmActive,
      pollingByConnection: pack.pollingByConnection,
      connections,
      opts: { deadband: 1 },
    })
    // Task3/0.19.3: 采样发生在提交阶段 — 与页面是否打开无关
    const pointsById = Object.fromEntries((points || []).map((p) => [p.id, p]))
    const trend = sampleTrendValues(pack.trend || {}, input && input.pointValues, pointsById)
    const patch = {
      values,
      framesByConnection,
      alarmState: alarmEval.next,
      trend,
      version: 3,
    }
    if (kind === 'poll' && input && input.pollingByConnection) {
      patch.pollingByConnection = { ...pack.pollingByConnection, ...input.pollingByConnection }
    }
    return { workspace: { ...ws, modbus: { ...ws.modbus, ...patch } } }
  })

export const commitReadResult = (home, cwd, result) => commit(home, cwd, result, 'read')
export const commitWriteResult = (home, cwd, result) => commit(home, cwd, result, 'write')
export const commitPollResult = (home, cwd, result) => commit(home, cwd, result, 'poll')
