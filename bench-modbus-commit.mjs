import { normalizeModbus } from './bench-devices.mjs'
import { evaluateAlarms } from './bench-alarm.mjs'
import { loadWorkspace, saveWorkspace } from './bench-store.mjs'
import { sampleTrendValues } from './bench-trend-store.mjs'

const tails = new Map()

const runExclusive = (cwd, fn) => {
  const key = String(cwd)
  const prev = tails.get(key) || Promise.resolve()
  const next = prev.then(fn, fn)
  tails.set(key, next.catch(() => { /* keep queue alive */ }))
  return next
}

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
  runExclusive(cwd, () => {
    const ws = loadWorkspace(home, cwd)
    const pack = normalizeModbus(ws.modbus)
    const framesByConnection = appendFrame(pack.framesByConnection, frame && frame.connectionId, frame)
    return saveWorkspace(home, cwd, { modbus: { framesByConnection, version: 3 } })
  })

const commit = (home, cwd, input, kind) =>
  runExclusive(cwd, () => {
    const ws = loadWorkspace(home, cwd)
    const pack = normalizeModbus(ws.modbus)
    const cid = String(input && input.connectionId || '')
    const did = String(input && input.deviceId || '')
    const connOk = !cid || pack.connections.some((c) => c.id === cid)
    const devOk = !did || pack.devices.some((d) => d.id === did)
    const drift = (input && input.baseConfigVersion && pack.configVersion && Number(input.baseConfigVersion) !== Number(pack.configVersion))
      || !connOk
      || !devOk
    let values = pack.values
    if (!drift && input && Array.isArray(input.pointValues) && input.pointValues.length) {
      const allowed = new Set(pack.points.map((p) => p.id))
      const incoming = input.pointValues.filter((rec) => rec && allowed.has(rec.pointId || rec.key))
      values = mergePointValues(pack.values, incoming)
    }
    let framesByConnection = pack.framesByConnection
    if (input && input.frame) {
      const frame = drift ? { ...input.frame, status: 'error', error: 'CONFIG_DRIFT' } : input.frame
      if (!cid || pack.connections.some((c) => c.id === cid) || drift) {
        framesByConnection = appendFrame(pack.framesByConnection, cid, frame)
      }
    }
    const alarmEval = evaluateAlarms({
      points: pack.points,
      values,
      prevState: pack.alarmState || pack.alarmActive,
      pollingByConnection: pack.pollingByConnection,
      connections: pack.connections,
      opts: { deadband: 1 },
    })
    // Task3/0.19.3: 采样发生在提交阶段 — 与页面是否打开无关
    const pointsById = Object.fromEntries((pack.points || []).map((p) => [p.id, p]))
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
    return saveWorkspace(home, cwd, { modbus: patch })
  })

export const commitReadResult = (home, cwd, result) => commit(home, cwd, result, 'read')
export const commitWriteResult = (home, cwd, result) => commit(home, cwd, result, 'write')
export const commitPollResult = (home, cwd, result) => commit(home, cwd, result, 'poll')
