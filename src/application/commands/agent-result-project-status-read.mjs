// @ts-check
import { AGENT_TEXT_CAPS, utf8ByteLength } from './agent-result-caps.mjs'

const READ_PAGE_DEFAULT = 20
const READ_PAGE_MAX = 50

/**
 * @param {any} result
 * @returns {Record<string, unknown>}
 */
export function pickSafetyFields(result) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of [
    'ok',
    'action',
    'commandId',
    'errorCode',
    'error',
    'details',
    'cancelled',
    'retryable',
    'refresh',
    'missingFields',
    'hint',
    'approval',
    'source',
    'sessionId',
    'idempotent',
    'conflicts',
  ]) {
    if (result[key] !== undefined) out[key] = result[key]
  }
  return out
}

/**
 * @param {any} projected
 * @param {number} capBytes
 * @param {string} nextHint
 * @param {(p: any) => any} [shrink]
 * @returns {any}
 */
export function enforceBudget(projected, capBytes, nextHint, shrink) {
  if (!Number.isFinite(capBytes) || capBytes <= 0) return projected
  if (utf8ByteLength(projected) <= capBytes) return projected
  let next = typeof shrink === 'function' ? shrink(projected) : projected
  if (utf8ByteLength(next) <= capBytes) return next
  return {
    ...pickSafetyFields(projected),
    ok: projected.ok,
    action: projected.action,
    overrun: true,
    hint: nextHint,
    truncated: true,
  }
}

/**
 * @param {any[]} connections
 * @param {any[]} [states]
 */
function summarizeConnections(connections, states) {
  const byId = new Map((Array.isArray(states) ? states : []).map((s) => [s.connectionId, s]))
  return (Array.isArray(connections) ? connections : []).map((c) => {
    const st = byId.get(c.id)
    const conn = c && c.conn && typeof c.conn === 'object' ? c.conn : {}
    return {
      id: c.id,
      name: c.name || '',
      enabled: c.enabled !== false,
      mode: conn.mode || '',
      sim: conn.sim === true,
      status: st && st.status ? st.status : '',
    }
  })
}

/**
 * @param {any[]} devices
 */
function summarizeDevices(devices) {
  return (Array.isArray(devices) ? devices : []).map((d) => ({
    id: d.id,
    connectionId: d.connectionId,
    name: d.name || '',
    unitId: d.unitId,
    enabled: d.enabled !== false,
  }))
}

/**
 * @param {any} alarmState
 */
function activeAlarmCount(alarmState) {
  if (!alarmState || typeof alarmState !== 'object') return 0
  let n = 0
  for (const alarm of Object.values(alarmState)) {
    if (alarm && typeof alarm === 'object' && alarm.condition === 'active') n += 1
  }
  return n
}

/**
 * @param {any[]} tasks
 */
function summarizeTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).slice(0, 12).map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    source: t.source,
    summary: t.summary,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
  }))
}

/**
 * @param {any} args
 * @returns {Set<string>}
 */
function requestedPointIds(args) {
  const ids = new Set()
  if (typeof args?.pointId === 'string' && args.pointId) ids.add(args.pointId)
  if (Array.isArray(args?.pointIds)) {
    for (const id of args.pointIds) {
      if (typeof id === 'string' && id) ids.add(id)
    }
  }
  if (Array.isArray(args?.points)) {
    for (const p of args.points) {
      if (p && typeof p.id === 'string' && p.id) ids.add(p.id)
      if (p && typeof p.pointId === 'string' && p.pointId) ids.add(p.pointId)
    }
  }
  return ids
}

/**
 * @param {any} reading
 */
function compactReading(reading) {
  return {
    connectionId: reading?.connectionId || '',
    deviceId: reading?.deviceId || '',
    function: reading?.function,
    address: reading?.address,
    count: reading?.count,
    raw: Array.isArray(reading?.raw) ? reading.raw : [],
    frameId: reading?.frameId || '',
    transactionId: reading?.transactionId || '',
  }
}

/**
 * @param {any} _args
 * @param {any} result
 */
export function projectStatus(_args, result) {
  const mb = result.modbus && typeof result.modbus === 'object' ? result.modbus : {}
  const keil = result.keil && typeof result.keil === 'object' ? result.keil : null
  /** @type {any[]} */
  const connections = Array.isArray(mb.connections) ? mb.connections : []
  /** @type {any[]} */
  const devices = Array.isArray(mb.devices) ? mb.devices : []
  /** @type {any[]} */
  const points = Array.isArray(mb.points) ? mb.points : []
  /** @type {any[]} */
  const connectionStates = Array.isArray(mb.connectionStates) ? mb.connectionStates : []
  /** @type {any[]} */
  const tasks = Array.isArray(result.tasks) ? result.tasks : []
  /** @type {any[]} */
  const running = Array.isArray(result.running) ? result.running : []
  /** @type {any[]} */
  const log = Array.isArray(result.log) ? result.log : []
  const projected = {
    ...pickSafetyFields(result),
    cwd: result.cwd,
    configVersion: result.configVersion ?? mb.configVersion,
    session: result.session,
    keil: keil ? { project: keil.project || '', target: keil.target || '' } : undefined,
    modbus: {
      version: mb.version,
      configVersion: mb.configVersion,
      activeConnectionId: mb.activeConnectionId,
      activeDeviceId: mb.activeDeviceId,
      connections: summarizeConnections(connections, connectionStates),
      devices: summarizeDevices(devices),
      counts: {
        connections: connections.length,
        devices: devices.length,
        points: points.length,
        alarmsActive: activeAlarmCount(mb.alarmState),
      },
      pollingByConnection: mb.pollingByConnection || {},
      conn: mb.conn,
    },
    tasks: summarizeTasks(tasks),
    running: summarizeTasks(running),
    log: log.slice(0, 20),
  }
  return enforceBudget(projected, AGENT_TEXT_CAPS.statusBytes, 'status 超预算：用 points/frames/alarm 分项查询', (p) => ({
    ...p,
    log: [],
    tasks: (p.tasks || []).slice(0, 4),
    running: (p.running || []).slice(0, 2),
    modbus: {
      ...p.modbus,
      connections: (p.modbus?.connections || []).slice(0, 8),
      devices: (p.modbus?.devices || []).slice(0, 8),
    },
  }))
}

/**
 * @param {any} args
 * @param {any} result
 */
export function projectRead(args, result) {
  const wanted = requestedPointIds(args)
  /** @type {any[]} */
  const allReadings = (Array.isArray(result.readings) ? result.readings : []).map(compactReading)
  /** @type {any[]} */
  const values = Array.isArray(result.values) ? result.values : []
  /** @type {any[]} */
  const framesLog = (Array.isArray(result.framesLog) ? result.framesLog : []).map((/** @type {any} */ f) => ({
    frameId: f?.frameId || f?.id || '',
    transactionId: f?.transactionId || '',
  }))

  const pageLimit = Math.max(1, Math.min(READ_PAGE_MAX, Number(args?.limit) || READ_PAGE_DEFAULT))
  const pageOffset = Math.max(0, Number(args?.offset) || Number(args?.cursor) || 0)

  /** @type {any[]} */
  let projectedValues = []
  /** @type {any[]} */
  let projectedReadings = allReadings
  let truncated = false
  /** @type {string | null} */
  let nextCursor = null
  const totalReadings = allReadings.length

  if (wanted.size > 0) {
    projectedValues = values.filter((/** @type {any} */ v) => wanted.has(String(v?.pointId || v?.key || '')))
    projectedReadings = allReadings
  } else if (args?.all === true) {
    // all:true — paginate this request's readings; never dump global values
    projectedValues = []
    if (pageOffset >= totalReadings) {
      projectedReadings = []
    } else {
      projectedReadings = allReadings.slice(pageOffset, pageOffset + pageLimit)
      if (pageOffset + pageLimit < totalReadings) {
        truncated = true
        nextCursor = String(pageOffset + pageLimit)
      }
    }
  } else if (allReadings.length > 0) {
    // scratch / batch without pointId — prefer readings only; scope to connection when given
    projectedValues = []
    projectedReadings = allReadings
    if (typeof args?.connectionId === 'string' && args.connectionId) {
      projectedReadings = allReadings.filter(
        (/** @type {any} */ r) => r.connectionId === args.connectionId,
      )
    }
    if (Number.isFinite(Number(args?.function)) || Number.isFinite(Number(args?.address))) {
      const fc = Number(args.function)
      const addr = Number(args.address)
      const cnt = Number(args.count)
      projectedReadings = projectedReadings.filter((/** @type {any} */ r) => {
        if (Number.isFinite(fc) && Number(r.function) !== fc) return false
        if (Number.isFinite(addr) && Number(r.address) !== addr) return false
        if (Number.isFinite(cnt) && Number(r.count) !== cnt) return false
        return true
      })
      if (projectedReadings.length === 0 && allReadings.length === 1) projectedReadings = allReadings
    }
  } else {
    // No pointId and no readings: never invent first-32 global values
    projectedValues = []
    projectedReadings = []
  }

  const head = projectedReadings[0] || allReadings[0]
  const functionCode =
    result.function != null && Number.isFinite(Number(result.function))
      ? Number(result.function)
      : head?.function != null
        ? Number(head.function)
        : Number.isFinite(Number(args?.function))
          ? Number(args.function)
          : undefined
  const address =
    result.address != null && Number.isFinite(Number(result.address))
      ? Number(result.address)
      : head?.address != null
        ? Number(head.address)
        : Number.isFinite(Number(args?.address))
          ? Number(args.address)
          : undefined
  const count =
    result.count != null && Number.isFinite(Number(result.count))
      ? Number(result.count)
      : head?.count != null
        ? Number(head.count)
        : Number.isFinite(Number(args?.count))
          ? Number(args.count)
          : undefined

  const connectionId = result.connectionId || head?.connectionId || args?.connectionId || args?.connId || ''
  const deviceId = result.deviceId || head?.deviceId || args?.deviceId || ''

  const singlePoint = wanted.size === 1 || (typeof args?.pointId === 'string' && !!args.pointId)
  const cap = singlePoint ? AGENT_TEXT_CAPS.singlePointReadBytes : AGENT_TEXT_CAPS.multiPointReadBytes

  const projected = {
    ...pickSafetyFields(result),
    taskId: result.taskId,
    simulated: result.simulated,
    summary: result.summary,
    results: result.results,
    connectionId,
    deviceId,
    pointId: result.pointId || (typeof args?.pointId === 'string' ? args.pointId : undefined),
    function: functionCode,
    address,
    count,
    readings: projectedReadings,
    values: projectedValues,
    framesLog: framesLog.slice(0, singlePoint || (args?.function != null && args?.address != null) ? 8 : 16),
    total: totalReadings,
    returned: projectedReadings.length,
    truncated: truncated || undefined,
    nextCursor,
  }

  return enforceBudget(
    projected,
    cap,
    'read 超预算：缩小 limit/pointId，或用 frames 查询报文',
    (p) => ({
      ...p,
      framesLog: (p.framesLog || []).slice(0, 2),
      readings: (p.readings || []).slice(0, Math.min(5, pageLimit)),
      values: (p.values || []).slice(0, 8),
      truncated: true,
      nextCursor: p.nextCursor || '0',
    }),
  )
}

/**
 * @param {any} result
 */

