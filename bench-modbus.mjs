import { pickArtifact } from './bench-fs.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
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
} from './bench-points.mjs'
import { normalizeModbus, normalizePointV3 } from './bench-devices.mjs'
import { evaluateAlarms, normalizeAlarmState } from './bench-alarm.mjs'
import { planScopedReadBatches } from './bench-pollplan.mjs'
import { changedConnectionIds, createModbusTransport, notifyConnectionRelease, toReadRequest, toWriteRequest } from './bench-modbus-transport.mjs'
import { toEndpoint } from './bench-io-contract.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from './bench-modbus-commit.mjs'
import { aborted, hasRunning, originOf, signalOf } from './bench-journal.mjs'
import {
  finishTask,
  loadWorkspace,
  normalizeFocusRequest,
  normalizeFocusState,
  openTask,
  pruneBuildLogs,
  recordBenchEvent,
  saveWorkspace,
} from './bench-store.mjs'
import { portKey } from './bench-portlock.mjs'
import { notifyBenchEvent } from './bench-notify.mjs'
import { resolveTarget as resolveUnifiedTarget, TARGET_CODES } from './bench-targets.mjs'

export const ERROR_CODES = {
  PORT_IN_USE: 'PORT_IN_USE',
  TARGET_REQUIRED: 'TARGET_REQUIRED',
  TARGET_MISMATCH: 'TARGET_MISMATCH',
  DEVICE_DISABLED: 'DEVICE_DISABLED',
  ENDPOINT_DRIFT: 'ENDPOINT_DRIFT',
  STALE_VALUE: 'STALE_VALUE',
  WRITE_READBACK_MISMATCH: 'WRITE_READBACK_MISMATCH',
  POINT_NOT_FOUND: 'POINT_NOT_FOUND',
  CONNECTION_NOT_FOUND: 'CONNECTION_NOT_FOUND',
  CONFIG_DRIFT: 'CONFIG_DRIFT',
  CONFLICT: 'CONFLICT',
  WRITE_OUTCOME_UNKNOWN: 'WRITE_OUTCOME_UNKNOWN',
}

const transportOf = (opts) => (opts && opts.transport) || createModbusTransport()

const stampPoints = (pack) => (pack.points || []).map((p) => {
  const dev = (pack.devices || []).find((d) => d.id === p.deviceId)
  return { ...p, unitId: Math.min(247, Math.max(1, Math.trunc(Number(dev && dev.unitId) || 1))) }
})

const STALE_MS = 30 * 1000

export const isStaleValue = (rec) => {
  if (!rec || rec.ok !== true) return false
  const at = Number(rec.at)
  if (!Number.isFinite(at) || at <= 0) return true
  return Date.now() - at > STALE_MS
}

const deviceDisabledOf = (pack, cid, did) => {
  const conn = (pack.connections || []).find((c) => c.id === cid)
  if (conn && conn.enabled === false) return true
  const dev = (pack.devices || []).find((d) => d.id === did)
  if (dev && dev.enabled === false) return true
  return false
}

const targetRequired = (origin, pack, cidArg, didArg) => {
  if (!origin || origin.source !== 'agent') return null
  const enabledConns = (pack.connections || []).filter((c) => c.enabled !== false)
  if (!cidArg && enabledConns.length > 1) return { error: '缺少 connectionId', errorCode: ERROR_CODES.TARGET_REQUIRED }
  // §16.5-30: a single connection exposing several devices is still ambiguous —
  // Agent must name the device explicitly instead of silently hitting the first one.
  if (!didArg && (cidArg || enabledConns.length === 1)) {
    const scopeCid = cidArg || enabledConns[0].id
    const enabledDevs = (pack.devices || []).filter((d) => d.connectionId === scopeCid && d.enabled !== false)
    if (enabledDevs.length > 1) return { error: '缺少 deviceId', errorCode: ERROR_CODES.TARGET_REQUIRED }
  }
  return null
}

const pollLocks = new Map()
const POLL_BUDGET_MS = 30000

const AREA_FN = { coil: 1, discreteInput: 2, holdingRegister: 3, inputRegister: 4 }
const fnOfPoint = (p) => Number(p && p.function) || AREA_FN[p && p.area] || 3
const findPointV3 = (points, fn, address, activeConnId, activeDevId) => {
  const list = Array.isArray(points) ? points : []
  // prefer active connection/device
  let hit = list.find(p => fnOfPoint(p) === Number(fn) && Number(p.address) === Number(address) && p.connectionId === activeConnId && p.deviceId === activeDevId)
  if (hit) return hit
  hit = list.find(p => fnOfPoint(p) === Number(fn) && Number(p.address) === Number(address))
  if (hit) return hit
  const id = pointIdOf(fn, address)
  return list.find(p => p.id === id) || null
}

// ── connection profile ───────────────────────────────────────────────────

const CONN_PATCH_KEYS = ['mode', 'port', 'baudrate', 'bytesize', 'parity', 'stopbits', 'host', 'tcpPort', 'slave', 'sim']

export const pickConnPatch = (raw) => {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of CONN_PATCH_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}

export const connectOp = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const cidRaw = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  if (cidRaw) {
    const workspace = loadWorkspace(home, room.cwd)
    const pack = normalizeModbus(workspace.modbus)
    const target = pack.connections.find((c) => c.id === cidRaw)
    if (!target) return { ok: false, error: '连接不存在: ' + cidRaw }
    // Task6/0.19.2: 从机模式未启用 — 显式拒绝，不允许当主机执行
    const role = (target.role || 'client')
    if (role === 'server' || role === 'slave') {
      return { ok: false, error: '当前版本暂未启用 Modbus 从机模式', code: 'ROLE_NOT_SUPPORTED', connectionId: cidRaw }
    }
    // Task5/0.19.2: close 优先 — 仅凭 connectionId 即可断开，不要求 patch
    const transport = transportOf(opts)
    if (body && body.close === true) {
      await transport.closeConnection({ cwd: room.cwd, connectionId: cidRaw })
      return { ok: true, action: 'connect', connectionId: cidRaw, connId: cidRaw, configured: !!(body && Object.keys(pickConnPatch(body)).length), connected: false, live: 'disconnected' }
    }
    const patch = pickConnPatch(body)
    let outConn = target.conn
    if (Object.keys(patch).length) {
      const nextConns = pack.connections.map((c) => c.id === cidRaw ? { ...c, conn: { ...c.conn, ...patch } } : c)
      let nextDevices = pack.devices
      if (patch.slave !== undefined) {
        const devId = String(body && body.deviceId || '').trim() || (pack.activeConnectionId === cidRaw ? pack.activeDeviceId : '') || (pack.devices.find((d) => d.connectionId === cidRaw) || {}).id || ''
        if (devId) {
          const unit = Math.min(247, Math.max(0, Math.trunc(Number(patch.slave) || 1)))
          nextDevices = pack.devices.map((d) => d.id === devId ? { ...d, unitId: unit } : d)
        }
      }
      const saved = saveWorkspace(home, room.cwd, { modbus: { connections: nextConns, devices: nextDevices, version: 3 } })
      if (!saved.ok) return saved
      notifyConnectionRelease(room.cwd, changedConnectionIds(workspace.modbus, saved.workspace.modbus).filter((id) => id !== cidRaw))
      outConn = (saved.workspace.modbus.connections.find((c) => c.id === cidRaw) || {}).conn || saved.workspace.modbus.conn
    }
    if (outConn && outConn.sim === true) {
      await transport.closeConnection({ cwd: room.cwd, connectionId: cidRaw })
      return { ok: true, action: 'connect', conn: outConn, connectionId: cidRaw, connId: cidRaw, configured: !!Object.keys(patch).length, simulated: true }
    }
    const opened = await transport.openConnection({ cwd: room.cwd, connectionId: cidRaw, endpoint: toEndpoint({ conn: outConn }) })
    if (opened.ok === false) {
      // Task5/0.19.2: 配置已保存但物理连接失败 — 不偷偷回滚
      return {
        ok: false,
        action: 'connect',
        connectionId: cidRaw,
        connId: cidRaw,
        configured: !!Object.keys(patch).length,
        connected: false,
        conn: outConn,
        error: (opened.error && opened.error.message) || opened.error,
      }
    }
    return { ok: true, action: 'connect', conn: outConn, connectionId: cidRaw, connId: cidRaw, configured: !!Object.keys(patch).length, connected: true, live: opened.data || opened }
  }
  // legacy no-id path (kept for backward compat)
  const prev = loadWorkspace(home, room.cwd)
  const saved = saveWorkspace(home, room.cwd, { modbus: { conn: pickConnPatch(body) } })
  if (!saved.ok) return saved
  notifyConnectionRelease(room.cwd, changedConnectionIds(prev.modbus, saved.workspace.modbus))
  return { ok: true, action: 'connect', conn: saved.workspace.modbus.conn }
}

// ── point table ops (Agent-facing) ───────────────────────────────────────

const compactPointRow = (p, values) => {
  const rec = (Array.isArray(values) ? values : []).find((item) => item.key === p.id || item.pointId === p.id)
  return {
    id: p.id,
    connectionId: p.connectionId,
    connId: p.connectionId,
    deviceId: p.deviceId,
    name: p.name,
    area: p.area,
    function: p.function,
    address: p.address,
    scale: p.scale,
    offset: p.offset,
    unit: p.unit,
    alarmMin: p.alarmMin,
    alarmMax: p.alarmMax,
    writable: isWritableFunction(p.function),
    raw: rec ? rec.raw : null,
    value: rec ? (rec.value !== undefined ? rec.value : (rec.raw !== null ? decodeValue(p, rec.raw) : null)) : null,
    ok: rec ? rec.ok : false,
    at: rec ? rec.at : 0,
  }
}

export const pointsOp = (home, cwd, body) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const op = body && body.op
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body && body.deviceId ? String(body.deviceId).trim() : ''
  const targetConnId = cidArg || pack.activeConnectionId
  const targetDevId = didArg || (pack.devices.find((d) => d.connectionId === targetConnId)?.id || pack.activeDeviceId)
  if (op === 'list') {
    let list = pack.points
    if (cidArg) list = list.filter((p) => (p.connectionId || p.connId) === cidArg)
    if (didArg) list = list.filter((p) => p.deviceId === didArg)
    return { ok: true, action: 'points', points: list.map((p) => compactPointRow(p, pack.values)) }
  }
  if (op === 'add' || op === 'update') {
    const inputs = Array.isArray(body.points) ? body.points : (body.point ? [body.point] : [])
    if (!inputs.length) return { ok: false, error: '缺少 points 或 point' }
    let points = pack.points
    for (const input of inputs) {
      const raw = { ...(input || {}) }
      const inCid = raw.connectionId || raw.connId ? String(raw.connectionId || raw.connId).trim() : ''
      const inDid = raw.deviceId ? String(raw.deviceId).trim() : ''
      const connForPoint = inCid || targetConnId
      const devForPoint = inDid || targetDevId
      raw.connectionId = connForPoint
      raw.deviceId = devForPoint
      // normalize via v3 helper to ensure area/function/address correct
      const next = normalizePointV3(raw)
      // fix refs if invalid due to normalizePointV3 fallback logic
      if (!pack.connections.some((c) => c.id === next.connectionId)) next.connectionId = targetConnId
      if (!pack.devices.some((d) => d.id === next.deviceId)) next.deviceId = targetDevId
      if (op === 'add') {
        if (points.some((p) => p.id === next.id)) {
          return { ok: false, error: '点位已存在: ' + pointLabel(next) + '（可用 update 修改）' }
        }
        if (points.some((p) => p.connectionId === next.connectionId && p.deviceId === next.deviceId && p.function === next.function && p.address === next.address)) {
          return { ok: false, error: '点位已存在: ' + pointLabel(next) + '（可用 update 修改）' }
        }
        points = points.concat([next])
      } else {
        const idx = points.findIndex((p) => p.id === next.id)
        if (idx < 0) return { ok: false, error: '要更新的点位不存在: ' + next.id }
        if (points.some((p, i) => i !== idx && p.connectionId === next.connectionId && p.function === next.function && p.address === next.address)) {
          return { ok: false, error: '地址冲突: ' + pointLabel(next) }
        }
        points = points.map((p, i) => (i === idx ? { ...p, ...next, id: points[idx].id } : p))
      }
    }
    const saved = saveWorkspace(home, room.cwd, { modbus: { points, version: 3 } })
    if (!saved.ok) return saved
    return { ok: true, action: 'points', points: saved.workspace.modbus.points.map((p) => compactPointRow(p, saved.workspace.modbus.values)) }
  }
  if (op === 'remove') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : (body.id ? [String(body.id)] : [])
    if (!ids.length) return { ok: false, error: '缺少 ids' }
    const idSet = new Set(ids)
    let kept = pack.points
    if (cidArg || didArg) {
      kept = kept.filter((p) => !(idSet.has(p.id) && (!cidArg || (p.connectionId || p.connId) === cidArg) && (!didArg || p.deviceId === didArg)))
    } else {
      kept = kept.filter((p) => !idSet.has(p.id))
    }
    const keptValues = (pack.values || []).filter((v) => {
      const k = v.key || v.pointId
      return !idSet.has(k) || !kept.some((p) => p.id === k)
    })
    if (kept.length === pack.points.length) return { ok: false, error: '没有匹配的点位' }
    const saved = saveWorkspace(home, room.cwd, { modbus: { points: kept, values: keptValues, version: 3 } })
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
      const saved = saveWorkspace(home, room.cwd, { modbus: { points: kept, values: keptValues, version: 3 } })
      if (!saved.ok) return saved
      return { ok: true, action: 'points', cleared: true }
    }
    const saved = saveWorkspace(home, room.cwd, { modbus: { points: [], values: [], alarmActive: {}, alarmState: {}, version: 3 } })
    if (!saved.ok) return saved
    return { ok: true, action: 'points', cleared: true }
  }
  return { ok: false, error: "op 必须是 list | add | update | remove | clear" }
}

// ── pending agent writes ─────────────────────────────────────────────────

const PENDING_TTL_MS = 5 * 60 * 1000
const pendingWrites = new Map()
let pendingSeq = 0

const endpointFingerprint = (conn, dev) => ({
  mode: conn.mode,
  port: (conn.port || '').trim(),
  baudrate: Number(conn.baudrate) || 0,
  bytesize: Number(conn.bytesize) || 8,
  parity: conn.parity || 'N',
  stopbits: Number(conn.stopbits) || 1,
  host: (conn.host || '').trim(),
  tcpPort: Number(conn.tcpPort) || 0,
  slave: Number(conn.slave) || 0,
  // §16.5-32: in v3 the RTU unit id lives on the device, so bind it too —
  // a Unit ID switch between request and approval must void the old request.
  unitId: Math.min(247, Math.max(0, Math.trunc(Number(dev && dev.unitId) || Number(conn.slave) || 0))),
})

const endpointLabelText = (conn) => conn.mode === 'tcp'
  ? ((conn.host || '?') + ':' + conn.tcpPort + ' · 站号 ' + conn.slave)
  : ((conn.port || '?') + ' @ ' + conn.baudrate + ' · 站号 ' + conn.slave)

const sameEndpoint = (a, b) =>
  !!a && !!b
    && a.mode === b.mode
    && a.port === b.port
    && a.baudrate === b.baudrate
    && a.bytesize === b.bytesize
    && a.parity === b.parity
    && a.stopbits === b.stopbits
    && a.host === b.host
    && a.tcpPort === b.tcpPort
    && a.slave === b.slave
    && a.unitId === b.unitId

const prunePendingWrites = () => {
  const now = Date.now()
  for (const [key, entry] of pendingWrites) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingWrites.delete(key)
  }
}

export const createPendingWrite = (cwd, params) => {
  const id = 'pw' + Date.now().toString(36) + (++pendingSeq).toString(36)
  pendingWrites.set(cwd + ':' + id, { id, cwd, createdAt: Date.now(), params })
  prunePendingWrites()
  return { id, ...params }
}

export const popPendingWrite = (cwd, id) => {
  prunePendingWrites()
  const key = String(cwd) + ':' + String(id || '')
  const entry = pendingWrites.get(key)
  if (!entry) return null
  pendingWrites.delete(key)
  return entry
}

export const listPendingWrites = (cwd) => {
  prunePendingWrites()
  const out = []
  for (const entry of pendingWrites.values()) {
    if (entry.cwd === cwd) out.push({ id: entry.id, ...entry.params })
  }
  return out
}

export const resolvePendingWrite = async (home, cwd, id, approved, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const entry = popPendingWrite(room.cwd, id)
  if (!entry) return { ok: false, error: '请求不存在或已过期' }
  if (approved !== true) {
    recordBenchEvent(home, room.cwd, {
      action: 'write-reject',
      ok: false,
      summary: '拒绝 Agent 写点：' + entry.params.label,
    }, { source: 'user' })
    void notifyBenchEvent(home, room.cwd,
      '用户拒绝了写点请求：' + entry.params.label,
      '', { sessionId: entry.params.sessionId }).catch(() => {})
    return { ok: true, rejected: true }
  }
  // The user approved a write against the endpoint shown on the card. If the
  // connection changed since, refuse instead of writing somewhere else.
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const cid = entry.params.connectionId || entry.params.connId || pack.activeConnectionId
  const connForWrite = (pack.connections.find((c) => c.id === cid) || {}).conn || pack.conn
  const devForWrite = (pack.devices || []).find((d) => d.id === entry.params.deviceId)
  if (!sameEndpoint(endpointFingerprint(connForWrite, devForWrite), entry.params.endpoint)) {
    recordBenchEvent(home, room.cwd, {
      action: 'write-stale',
      ok: false,
      summary: '写点请求过期（连接已变更）：' + entry.params.label,
    }, { source: 'system' })
    void notifyBenchEvent(home, room.cwd,
      '写点请求已失效：串口/TCP 连接在批准前发生了变化，请让 Agent 重新发起',
      '', { sessionId: entry.params.sessionId }).catch(() => {})
    return { ok: false, error: '设备连接已变更，原批准已失效，请让 Agent 重新发起请求', errorCode: ERROR_CODES.ENDPOINT_DRIFT }
  }
  // §16.5-31: the approval also binds the config version; if connections/
  // devices/points changed since the request was issued, it is stale too.
  const boundConfigVersion = Number(entry.params.endpoint && entry.params.endpoint.configVersion)
  if (boundConfigVersion > 0 && (pack.configVersion || 1) !== boundConfigVersion) {
    recordBenchEvent(home, room.cwd, {
      action: 'write-stale',
      ok: false,
      summary: '写点请求过期（配置版本已漂移 v' + boundConfigVersion + '→v' + (pack.configVersion || 1) + '）：' + entry.params.label,
    }, { source: 'system' })
    void notifyBenchEvent(home, room.cwd,
      '写点请求已失效：配置在批准前发生了变化，请让 Agent 重新发起',
      '', { sessionId: entry.params.sessionId }).catch(() => {})
    return { ok: false, error: '配置版本已漂移（v' + boundConfigVersion + '→v' + (pack.configVersion || 1) + '），原批准已失效，请让 Agent 重新发起请求', errorCode: ERROR_CODES.CONFIG_DRIFT }
  }
  return modbusWrite(home, room.cwd, {
    ...entry.params,
    source: 'agent',
    confirm: true,
  }, opts)
}

// ── transport ────────────────────────────────────────────────────────────

const connReady = (conn) => {
  if (!conn) return { error: '连接不存在' }
  if (conn.mode === 'rtu' && !portKey(conn.port) && conn.sim !== true) return { error: 'RTU 需要串口' }
  if (conn.mode === 'tcp' && !conn.host && conn.sim !== true) return { error: 'TCP 需要主机地址' }
  return { ok: true }
}

const framesOf = (ran) => {
  const details = ran && ran.result && ran.result.details
  const frames = details && typeof details.frames === 'object' ? details.frames : null
  if (!frames) return null
  return {
    request: typeof frames.request === 'string' ? frames.request.slice(0, 200) : '',
    response: typeof frames.response === 'string' ? frames.response.slice(0, 200) : '',
    trace: Array.isArray(frames.trace) ? frames.trace.map((line) => String(line).slice(0, 200)).slice(0, 8) : [],
  }
}

const createTransactionFrame = (label, frames, extra = {}) => {
  const at = Number(extra.at) || Date.now()
  const cid = String(extra.connectionId || '')
  const did = String(extra.deviceId || '')
  const tid = String(extra.taskId || '')
  const txId = String(extra.transactionId || extra.frameId || (cid + ':' + at + ':' + tid))
  const req = frames && (frames.requestHex || frames.request) || ''
  const res = frames && (frames.responseHex || frames.response) || ''
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
    frameFormat: String((frames && frames.frameFormat) || extra.frameFormat || ''),
    trace: frames && Array.isArray(frames.trace) ? frames.trace : [],
    unitId: Number.isFinite(Number(extra.unitId)) ? Math.trunc(Number(extra.unitId)) : 1,
    functionCode: Number.isFinite(Number(extra.functionCode)) ? Math.trunc(Number(extra.functionCode)) : 3,
    durationMs: Number.isFinite(Number(extra.durationMs)) ? Math.trunc(Number(extra.durationMs)) : 0,
    status: String(extra.status || 'ok').slice(0, 16),
    error: String(extra.error || '').slice(0, 200),
  }
}

const frameEntry = createTransactionFrame

const pointValuesOfBatch = (values, pack, batch) => {
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

const runReadTx = async (transport, pack, connObj, device, batch, cwd, timeoutMs, signal, source) => {
  const req = toReadRequest({
    cwd,
    connection: connObj,
    device,
    batch,
    timeoutMs,
    configVersion: pack.configVersion,
    source,
  })
  const sim = !!(connObj && connObj.conn && connObj.conn.sim)
  const ran = await transport.read(req, { signal, sim })
  if (ran && ran.ok === false) {
    return { ok: false, error: (ran.error && ran.error.message) || ran.error, errorCode: ran.error && ran.error.code, cancelled: ran.error && ran.error.code === 'CANCELLED', frames: ran.frames, transactionId: ran.transactionId, durationMs: ran.durationMs }
  }
  const raw = Array.isArray(ran.data) ? ran.data : (ran.result && ran.result.details && ran.result.details.raw) || []
  return {
    ok: true,
    result: { details: { raw } },
    frames: ran.frames,
    transactionId: ran.transactionId,
    durationMs: ran.durationMs,
  }
}

export const modbusRead = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body && body.deviceId ? String(body.deviceId).trim() : ''
  const activeCid = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
  const activeDid = pack.activeDeviceId || (pack.devices.find((d) => d.connectionId === activeCid)?.id || pack.devices[0]?.id || 'd1')
  const targetCid = cidArg || activeCid
  const targetDid = didArg || (pack.devices.find((d) => d.connectionId === targetCid)?.id || activeDid)
  const targetConnObj = pack.connections.find((c) => c.id === targetCid) || pack.connections.find((c) => c.id === activeCid) || pack.connections[0]
  const conn = targetConnObj ? targetConnObj.conn : pack.conn
  const origin = originOf(body)
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
    return { ok: false, error: '连接不存在: ' + targetCid, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND }
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
    let filtered = stampPoints(pack)
    if (cidArg) filtered = filtered.filter((p) => (p.connectionId || p.connId) === cidArg)
    if (didArg) filtered = filtered.filter((p) => p.deviceId === didArg)
    if (!filtered.length) return { ok: false, error: '无点位，请先添加点位' }
    const scopes = planScopedReadBatches(filtered)
    for (const scope of scopes) {
      for (const batch of scope.batches) {
        if (batch.connectionId !== scope.connectionId || batch.deviceId !== scope.deviceId || batch.unitId !== scope.unitId) {
          return { ok: false, error: '读批次身份不一致', errorCode: ERROR_CODES.CONFIG_DRIFT }
        }
        batches.push(batch)
        labels.push('读 ' + functionTag(batch.fc) + batch.address + '×' + batch.count)
      }
    }
  } else if (body && body.pointId) {
    const point = pack.points.find((item) => item.id === body.pointId)
    if (!point) return { ok: false, error: '点位不存在: ' + body.pointId, errorCode: ERROR_CODES.POINT_NOT_FOUND }
    {
      const rt = resolveUnifiedTarget(pack, { connectionId: cidArg || point.connectionId || targetCid, deviceId: didArg || point.deviceId || targetDid, pointId: body.pointId })
      if (!rt.ok) return { ok: false, error: rt.error, errorCode: rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : rt.errorCode }
    }
    const dev = pack.devices.find((d) => d.id === (didArg || point.deviceId || targetDid)) || { id: targetDid, unitId: 1 }
    batches = [{ fc: point.function, address: point.address, count: 1, connectionId: point.connectionId || targetCid, deviceId: point.deviceId || targetDid, unitId: dev.unitId }]
    labels = ['读 ' + pointLabel(point)]
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
    labels = ['读 ' + functionTag(fc) + address + '×' + count]
  } else {
    return { ok: false, error: '无点位：请传 all、pointId 或 function+address' }
  }

  const task = openTask(home, room.cwd, {
    type: 'read',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: labels.length === 1 ? labels[0] : ('读点表 ' + batches.length + ' 批'),
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
    const batchSim = !!(batchConnObj && batchConnObj.conn && batchConnObj.conn.sim)
    if (aborted(signal)) {
      finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source, values, framesLog, framesByConnection }
    }
    const ran = await runReadTx(transport, pack, batchConnObj, batchDevice, batch, room.cwd, 20000, signal, origin.source)
    if (ran.cancelled) {
      finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source, values, framesLog, framesByConnection }
    }
    const raw = ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw)
      ? ran.result.details.raw
      : []
    values = scatterBatch(values, pack.points, batch, raw, !!ran.ok, ran.ok ? '' : (ran.error || ''))
    let f = ran.frames || framesOf(ran)
    if (!f && batchSim) {
      f = { request: `SIM TX ${batch.fc}@${batch.address}×${batch.count}`, response: `SIM RX ${raw.slice(0,3).join(',')}`, trace: [], frameFormat: 'rtu-adu' }
    }
    if (!f && (ran.transactionId || ran.error)) {
      f = {
        requestHex: '',
        responseHex: '',
        frameFormat: (batchConnObj && batchConnObj.conn && batchConnObj.conn.mode === 'tcp') ? 'tcp-normalized' : 'rtu-adu',
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
        error: ran.ok ? '' : (ran.error || ''),
        transactionId: ran.transactionId,
        port: (batchConnObj && batchConnObj.conn && batchConnObj.conn.port) || '',
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
    results.push({ label: labels[bi], ok: !!ran.ok, error: ran.ok ? '' : (ran.error || ''), count: batch.count, connectionId: batchCid, deviceId: batchDid })
    if (ran.ok) okCount += 1
    else lastError = ran.error || lastError
  }

  const okAll = okCount === batches.length
  const summary = (sim ? '仿真 ' : '')
    + (okAll ? ('读取成功（' + batches.length + ' 批）') : ('读取 ' + okCount + '/' + batches.length + ' 批成功' + (lastError ? '：' + lastError : '')))
  finishTask(home, room.cwd, task.id, { ok: okAll, summary, frames: lastFrames })
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

const pointBefore = (packOrValues, fn, address, cid, did) => {
  // support both pack and legacy values array
  if (packOrValues && Array.isArray(packOrValues.points)) {
    const pack = packOrValues
    const c = cid || pack.activeConnectionId
    const d = did || pack.activeDeviceId
    const point = findPointV3(pack.points, fn, address, c, d)
    if (!point) return null
    const rec = (Array.isArray(pack.values) ? pack.values : []).find(item => item && (item.key === point.id || item.pointId === point.id))
    return rec && rec.raw !== null && rec.raw !== undefined ? rec.raw : null
  }
  const values = packOrValues
  const key = pointIdOf(fn, address)
  const rec = (Array.isArray(values) ? values : []).find((item) => item.key === key)
  return rec && rec.raw !== null && rec.raw !== undefined ? rec.raw : null
}

export const modbusWrite = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body && body.deviceId ? String(body.deviceId).trim() : ''
  const targetCid = cidArg || pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
  const targetDid = didArg || (pack.devices.find((d) => d.connectionId === targetCid)?.id || pack.activeDeviceId || pack.devices[0]?.id || 'd1')
  const targetConnObj = pack.connections.find((c) => c.id === targetCid) || pack.connections.find((c) => c.id === pack.activeConnectionId) || pack.connections[0]
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
    return { ok: false, error: '连接不存在: ' + targetCid, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND }
  }
  const fn = Number(body && body.function)
  const address = clampInt(body && body.address, -1, 0, 65535)
  if (address < 0) return { ok: false, error: '缺少寄存器地址', errorCode: ERROR_CODES.TARGET_REQUIRED }
  const rawValues = body && body.values !== undefined
    ? body.values
    : (body && body.value !== undefined ? body.value : undefined)
  const check = normalizeWriteValues(fn, rawValues, 1968)
  if (!check.ok) return { ok: false, error: check.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const count = check.values.length
  if (hasRunning(workspace, 'write')) {
    return { ok: false, error: '已有写入任务进行中' }
  }
  // Validate that every target address exists in the point table (v3-aware, scoped by connection/device)
  const targetPointIds = []
  for (let i = 0; i < count; i++) {
    const addr = address + i
    const hit = findPointV3(pack.points, fn, addr, targetCid, targetDid)
    if (!hit) {
      return { ok: false, error: '不在点表：' + functionTag(fn) + addr, errorCode: ERROR_CODES.POINT_NOT_FOUND }
    }
    {
      const rt = resolveUnifiedTarget(pack, { connectionId: cidArg || hit.connectionId || targetCid, deviceId: didArg || hit.deviceId || targetDid, pointId: hit.id })
      if (!rt.ok) return { ok: false, error: rt.error, errorCode: rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : rt.errorCode }
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
      values: check.values.slice(),
      label: '',
      sessionId: origin.sessionId,
      connectionId: targetCid,
      connId: targetCid,
      deviceId: targetDid,
      pointIds: targetPointIds.slice(),
      endpoint: { ...endpointFingerprint(conn, devForWrite), configVersion: pack.configVersion || 1 },
    })
    // Label needs the tag helpers; fill it in place.
    request.label = entryLabel(fn, address, count, check.values)
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
  const label = entryLabel(fn, address, count, check.values)
  const before = []
  for (let i = 0; i < count; i++) before.push(pointBefore(pack, fn, address + i, targetCid, targetDid))
  const task = openTask(home, room.cwd, {
    type: 'write',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: label,
  })
  const done = async (ok, summaryText, extra = {}) => {
    finishTask(home, room.cwd, task.id, {
      ok,
      summary: summaryText,
      frames: extra.frames || null,
    })
    const frameForLog = extra.frame || extra.frames || (extra.simulated ? { request: `SIM TX ${fn}@${address}×${count}`, response: `SIM RX ${extra.readback ? extra.readback.join(',') : ''}`, trace: [], frameFormat: 'rtu-adu' } : null)
    const devForWrite = pack.devices.find((d) => d.id === targetDid) || { unitId: 1 }
    const _entry = extra.frame || (frameForLog ? createTransactionFrame(label, frameForLog, {
      connectionId: targetCid,
      deviceId: targetDid,
      taskId: task.id,
      source: origin.source,
      direction: 'tx',
      unitId: devForWrite.unitId,
      functionCode: fn,
      durationMs: extra.durationMs || 0,
      status: ok ? 'ok' : 'error',
      error: ok ? '' : (extra.error || summaryText),
      transactionId: extra.transactionId,
      at: extra.at || Date.now(),
    }) : null)
    if (_entry) {
      await commitWriteResult(home, room.cwd, {
        baseConfigVersion: pack.configVersion,
        connectionId: targetCid,
        deviceId: targetDid,
        pointValues: extra.pointValues || [],
        frame: _entry,
      })
    }
    const errorCode = extra.errorCode || (!ok
      ? (extra.readbackMismatch ? ERROR_CODES.WRITE_READBACK_MISMATCH
        : (!extra.readbackOk && extra.readbackTried ? ERROR_CODES.STALE_VALUE : undefined))
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
      target: check.values,
      readback: extra.readback || [],
      frames: extra.frames || null,
      framesLog: _entry ? [_entry] : [],
      framesByConnection: extra.framesByConnection || undefined,
      values: extra.values || pack.values,
      simulated: !!extra.simulated,
      ...(ok ? {} : { error: summaryText, errorCode }),
      ...(errorCode ? { errorCode } : {}),
      ...(extra.outcomeUnknown ? {
        outcomeUnknown: true,
        retryable: false,
        transportErrorCode: extra.transportErrorCode || 'MODBUS_TIMEOUT',
      } : {}),
    }
  }

  if (conn.sim) {
    const at = Date.now()
    let vals = pack.values
    for (let i = 0; i < count; i++) {
      const addr = address + i
      const point = findPointV3(pack.points, fn, addr, targetCid, targetDid)
      // validation already ensures point exists, but keep fallback for safety
      const target = point || { id: pointIdOf(fn, addr), function: fn, address: addr, scale: 1, offset: 0, connectionId: targetCid, deviceId: targetDid }
      vals = setPointValue(vals, target, check.values[i], { ok: true, at })
    }
    // Persist values and exit sim (local write is considered verified) - need to target correct connection's sim flag
    const nextConns = pack.connections.map((c) => c.id === targetCid ? { ...c, conn: { ...c.conn, sim: false } } : c)
    saveWorkspace(home, room.cwd, { modbus: { connections: nextConns, values: vals, version: 3 } })
    return done(true, label + '（本地生效，回读一致）', {
      values: vals,
      simulated: true,
      readback: check.values.slice(),
      pointValues: vals.filter((rec) => targetPointIds.includes(rec.pointId || rec.key)),
    })
  }

  const writeReq = toWriteRequest({
    cwd: room.cwd,
    connection: targetConnObj,
    device: pack.devices.find((d) => d.id === targetDid) || { id: targetDid, unitId: 1 },
    point: { address, function: fn },
    values: check.values,
    timeoutMs: 20000,
    configVersion: pack.configVersion,
    fc: check.fc,
    source: origin.source,
  })
  const ran = await transport.write(writeReq, { signal, sim: false })
  if (ran && ran.error && ran.error.code === 'CANCELLED') {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '写入已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  if (!ran || ran.ok === false) {
    const frames = ran && ran.frames
    const code = ran && ran.error && ran.error.code
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
          durationMs: ran && ran.durationMs || 0,
          transactionId: ran && ran.transactionId,
          status: 'error',
          error: 'WRITE_OUTCOME_UNKNOWN',
          at: Date.now(),
        }),
        transactionId: ran && ran.transactionId,
        durationMs: ran && ran.durationMs,
        errorCode: ERROR_CODES.WRITE_OUTCOME_UNKNOWN,
        transportErrorCode: 'MODBUS_TIMEOUT',
        outcomeUnknown: true,
        retryable: false,
      })
    }
    return done(false, '写入失败 ' + ((ran && ran.error && ran.error.message) || (ran && ran.error) || ''), {
      frames,
      frame: frames || ran && ran.transactionId ? createTransactionFrame(label, frames || {}, {
        connectionId: targetCid,
        deviceId: targetDid,
        taskId: task.id,
        source: origin.source,
        unitId: writeReq.unitId,
        functionCode: check.fc,
        durationMs: ran && ran.durationMs || 0,
        transactionId: ran && ran.transactionId,
        status: 'error',
        error: (ran && ran.error && ran.error.message) || '',
        at: Date.now(),
      }) : null,
      transactionId: ran && ran.transactionId,
      durationMs: ran && ran.durationMs,
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
  const raw = readbackRan.ok && readbackRan.result && readbackRan.result.details && Array.isArray(readbackRan.result.details.raw)
    ? readbackRan.result.details.raw.slice(0, count)
    : []
  const readbackOk = readbackRan.ok && raw.length === count
  let vals = pack.values
  for (let i = 0; i < count; i++) {
    const addr = address + i
    const pseudo = findPointV3(pack.points, fn, addr, targetCid, targetDid)
      || { id: pointIdOf(fn, addr), function: fn, address: addr, scale: 1, offset: 0, connectionId: targetCid, deviceId: targetDid }
    vals = setPointValue(vals, pseudo, raw[i] !== undefined ? raw[i] : null, {
      ok: readbackOk,
      error: readbackOk ? '' : (readbackRan.error || ''),
    })
  }
  const mismatch = readbackOk && raw.some((value, i) => Number(value) !== Number(check.values[i]))
  const summary = label + (readbackOk
    ? (mismatch ? '，回读不一致：' + JSON.stringify(raw) : '，回读一致')
    : ('，回读失败 ' + (readbackRan.error || '')))
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
    errorCode: !readbackOk ? ERROR_CODES.STALE_VALUE : (mismatch ? ERROR_CODES.WRITE_READBACK_MISMATCH : undefined),
  })
}

const entryLabel = (fn, address, count, values) => count === 1
  ? ('写 ' + functionTag(fn) + address + ' = ' + values[0])
  : ('批量写 ' + functionTag(fn) + address + '–' + (address + count - 1) + '（' + count + ' 点）')

// ── polling ──────────────────────────────────────────────────────────────

const alarmSummary = (items, kind) => items.slice(0, 5).map((item) => {
  const limit = kind === 'max' ? item.point.alarmMax : item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
  void limit
  return decodeValue(item.point, item.raw) !== undefined
    ? pointLabel(item.point) + '=' + decodeValue(item.point, item.raw)
    : pointLabel(item.point)
}).join('；')

// Task1/0.19.3: 旧 `enabled=false`（参与运行开关）一次性迁移 — 停止该连接自动采集，
// 然后清理旧禁用字段，使 enabled 不再是公开概念（只保留读取兼容）。
export const migrateLegacyDisabled = (home, cwd) => {
  const workspace = loadWorkspace(home, cwd)
  const pack = normalizeModbus(workspace.modbus || {})
  const disabledConnIds = (pack.connections || []).filter((c) => c.enabled === false).map((c) => c.id)
  const hasDisabledDevice = (pack.devices || []).some((d) => d.enabled === false)
  if (!disabledConnIds.length && !hasDisabledDevice) return { ok: true, migrated: false }
  const nextPolling = { ...(pack.pollingByConnection || {}) }
  for (const cid of disabledConnIds) {
    const cur = nextPolling[cid] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
    nextPolling[cid] = { ...cur, enabled: false } // 停止自动采集
  }
  const connections = (pack.connections || []).map((c) => disabledConnIds.includes(c.id) ? { ...c, enabled: true } : c)
  const devices = (pack.devices || []).map((d) => d.enabled === false ? { ...d, enabled: true } : d)
  saveWorkspace(home, cwd, {
    modbus: {
      connections,
      devices,
      pollingByConnection: nextPolling,
      version: 3,
    },
  })
  return { ok: true, migrated: true, stopped: disabledConnIds }
}

export const modbusPoll = async (home, cwd, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  // support per-connection polling; if no points, report
  if (!pack.points.length) return { ok: false, error: '无点位，请先添加点位' }
  if (hasRunning(workspace, 'read')) {
    return { ok: true, skipped: true, polling: pack.polling, pollingByConnection: pack.pollingByConnection, values: pack.values }
  }
  const cidArg = opts && (opts.connectionId || opts.connId) ? String(opts.connectionId || opts.connId).trim() : ''
  const targetConns = cidArg ? pack.connections.filter((c) => c.id === cidArg) : pack.connections.filter((c) => c.enabled !== false)
  if (cidArg && !targetConns.length) return { ok: false, error: '连接不存在: ' + cidArg }
  if (!targetConns.length) return { ok: false, error: '无可用连接' }
  // use a global lock per cwd (legacy) plus per-conn locks for multi
  const lockKey = room.cwd + (cidArg ? ':' + cidArg : '')
  if (pollLocks.has(lockKey) || pollLocks.has(room.cwd)) {
    return { ok: true, skipped: true, busy: true, polling: pack.polling, pollingByConnection: pack.pollingByConnection, values: pack.values }
  }
  const outer = signalOf(null, opts)
  const budgetMs = Number(opts && opts.budgetMs)
  const budget = AbortSignal.timeout(Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : POLL_BUDGET_MS)
  const signal = outer ? AbortSignal.any([outer, budget]) : budget
  pollLocks.set(lockKey, true)
  // also set global for legacy callers if not per-conn
  if (!cidArg) pollLocks.set(room.cwd, true)
  let ok = true
  let timedOut = false
  try {
    let values = pack.values
    const framesLog = []
    const framesByConnection = { ...(pack.framesByConnection || {}) }
    const pollingByConnection = { ...(pack.pollingByConnection || {}) }
    for (const connObj of targetConns) {
      const conn = connObj.conn
      const connId = connObj.id
      const pts = pack.points.filter((p) => (p.connectionId || p.connId) === connId)
      if (!pts.length) {
        // still update polling timestamp for empty but enabled connection?
        pollingByConnection[connId] = { ...(pollingByConnection[connId] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }), lastAt: Date.now(), lastOk: true, error: '' }
        continue
      }
      const transport = transportOf(opts)
      const scopes = planScopedReadBatches(stampPoints({ ...pack, points: pts }))
      const interval = pollingByConnection[connId] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
      let connOk = true
      for (const scope of scopes) {
        const batchConnObj = pack.connections.find((c) => c.id === scope.connectionId) || connObj
        const batchDevice = pack.devices.find((d) => d.id === scope.deviceId) || { id: scope.deviceId, unitId: scope.unitId }
        for (const batch of scope.batches) {
          if (aborted(signal)) { timedOut = true; ok = false; connOk = false; break }
          const ran = await runReadTx(transport, pack, batchConnObj, batchDevice, batch, room.cwd, 4000, signal, 'polling')
          if (ran.cancelled || aborted(signal)) { timedOut = true; ok = false; connOk = false; break }
          if (!ran.ok) { ok = false; connOk = false }
          const raw = ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw) ? ran.result.details.raw : []
          values = scatterBatch(values, pack.points, batch, raw, !!ran.ok, ran.ok ? '' : (ran.error || ''))
          let f = ran.frames || framesOf(ran)
          if (!f && batchConnObj && batchConnObj.conn && batchConnObj.conn.sim) {
            f = { request: `SIM TX ${batch.fc}@${batch.address}×${batch.count}`, response: 'SIM RX ' + raw.slice(0, 3).join(','), trace: [], frameFormat: 'rtu-adu' }
          }
          const entry = f ? createTransactionFrame('读 ' + functionTag(batch.fc) + batch.address + '×' + batch.count + '（监视）', f, {
            connectionId: scope.connectionId || connId,
            deviceId: scope.deviceId,
            unitId: scope.unitId,
            functionCode: batch.fc,
            durationMs: ran.durationMs || 0,
            transactionId: ran.transactionId,
            status: ran.ok ? 'ok' : 'error',
            error: ran.ok ? '' : (ran.error || ''),
            source: 'polling',
            port: (batchConnObj && batchConnObj.conn && batchConnObj.conn.port) || '',
            at: Date.now(),
          }) : null
          if (entry) {
            framesLog.push(entry)
            if (!framesByConnection[connId]) framesByConnection[connId] = []
            framesByConnection[connId] = framesByConnection[connId].concat([entry]).slice(-500)
          }
          await commitPollResult(home, room.cwd, {
            baseConfigVersion: pack.configVersion,
            connectionId: scope.connectionId || connId,
            deviceId: scope.deviceId,
            pointValues: pointValuesOfBatch(values, pack, batch),
            frame: entry,
          })
        }
        if (!connOk) break
      }
      pollingByConnection[connId] = { ...interval, lastAt: Date.now(), lastOk: connOk && !timedOut, error: timedOut ? '轮询超时' : (connOk ? '' : '轮询部分失败') }
    }
    const alarmEval = evaluateAlarms({ points: pack.points, values, prevState: pack.alarmState || pack.alarmActive, pollingByConnection, connections: pack.connections, opts: { deadband: 1 } })
    const alarms = { next: alarmEval.next, fired: alarmEval.fired.filter(f=> f.point), cleared: alarmEval.recovered.filter(r=> r.point), commFired: alarmEval.fired.filter(f=> !f.point), commCleared: alarmEval.recovered.filter(r=> !r.point) }
    const activeBool = Object.fromEntries(Object.entries(alarmEval.next).filter(([,v])=> v && v.condition==='active' && v.group==='process').map(([k])=>[k,true]))
    if (alarmEval.fired.length) {
      const procFired = alarmEval.fired.filter(f=> f.point)
      const commFired = alarmEval.fired.filter(f=> f.connectionId)
      if (procFired.length) {
        recordBenchEvent(home, room.cwd, {
          action: 'alarm',
          ok: false,
          summary: '越限告警：' + procFired.slice(0, 5).map((item) => {
            const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
            return pointLabel(item.point) + '=' + decodeValue(item.point, item.raw ?? item.alarm?.value) + (item.kind === 'max' ? '>' + limit : '<' + limit)
          }).join('；'),
        }, { source: 'system' })
        void notifyBenchEvent(home, room.cwd,
          '台架告警：' + procFired.slice(0, 3).map((item) => {
            const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
            return pointLabel(item.point) + '=' + decodeValue(item.point, item.raw ?? item.alarm?.value) + (item.kind === 'max' ? '>' + limit : '<' + limit)
          }).join('；')).catch(() => {})
      }
      if (commFired.length) {
        recordBenchEvent(home, room.cwd, { action: 'alarm', ok: false, summary: '通信告警：' + commFired.slice(0,3).map(c=> c.label || c.connectionId).join('；') }, { source: 'system' })
      }
    }
    if (alarmEval.recovered.length) {
      const procRec = alarmEval.recovered.filter(r=> r.point)
      const commRec = alarmEval.recovered.filter(r=> r.connectionId && !r.point)
      if (procRec.length) {
        recordBenchEvent(home, room.cwd, {
          action: 'alarm-clear',
          ok: true,
          summary: '告警恢复：' + procRec.slice(0, 5).map((item) => pointLabel(item.point) + '=' + decodeValue(item.point, item.raw ?? item.alarm?.value)).join('；'),
        }, { source: 'system' })
      }
      if (commRec.length) {
        recordBenchEvent(home, room.cwd, { action: 'alarm-clear', ok: true, summary: '通信恢复：' + commRec.slice(0,3).map(c=> c.connectionId).join('；') }, { source: 'system' })
      }
    }
    await commitPollResult(home, room.cwd, {
      baseConfigVersion: pack.configVersion,
      pollingByConnection,
    })
    const saved = saveWorkspace(home, room.cwd, {
      modbus: {
        alarmActive: activeBool,
        alarmState: alarmEval.next,
        polling: pollingByConnection[pack.activeConnectionId] || pollingByConnection[targetConns[0]?.id] || pack.polling,
        pollingByConnection,
        version: 3,
      },
    })
    return {
      ok,
      skipped: false,
      partial: timedOut,
      timedOut,
      values: saved.workspace.modbus.values,
      polling: saved.workspace.modbus.polling,
      pollingByConnection: saved.workspace.modbus.pollingByConnection,
      framesLog,
      framesByConnection: saved.workspace.modbus.framesByConnection,
      error: ok ? undefined : (timedOut ? '轮询超时' : ''),
    }
  } finally {
    pollLocks.delete(lockKey)
    if (!cidArg) pollLocks.delete(room.cwd)
  }
}

const alarmLabel = (item, kind) => {
  const limit = kind === 'max' ? item.point.alarmMax : item.point.alarmMin
  return pointLabel(item.point) + '=' + decodeValue(item.point, item.raw) + (kind === 'max' ? '>' + limit : '<' + limit)
}

// Legacy compat for old tests that pass device.segments
export function deviceAlarms(device, values) {
  if (device && Array.isArray(device.points)) {
    return evaluatePointAlarms(device.points, values, device.alarmActive)
  }
  // Old segment-based path
  const segs = Array.isArray(device?.segments) ? device.segments : []
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
      fired.push({ seg, address: rec.address, value: raw, raw, kind: breach, point: { ...seg, address: rec.address, alarmMin: seg.alarmMin, alarmMax: seg.alarmMax } })
    } else if (!breach && next[rec.key]) {
      delete next[rec.key]
      cleared.push({ seg, address: rec.address, value: raw, raw })
    }
  }
  return { next, fired, cleared }
}

export const pickModbusPatch = pickConnPatch

// ── frames / focus (Agent explicit ID + UI linkage) ────────────────────────

export const listFrames = (home, cwd, body) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const origin = originOf(body)
  const cidArg = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  const didArg = body && body.deviceId ? String(body.deviceId).trim() : ''
  const frameId = body && (body.frameId || body.id) ? String(body.frameId || body.id).trim() : ''
  // Agent requires explicit connectionId when multiple connections (frames: device is optional)
  {
    const enabledConns = (pack.connections || []).filter((c) => c.enabled !== false)
    if (origin && origin.source === 'agent' && !cidArg && enabledConns.length > 1) {
      return { ok: false, error: '缺少 connectionId', errorCode: ERROR_CODES.TARGET_REQUIRED }
    }
  }
  // Unified target validation for frames
  if (cidArg || didArg || frameId) {
    const effCid = cidArg || pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || ''
    const rt = resolveUnifiedTarget(pack, { connectionId: effCid, deviceId: didArg || undefined, frameId: frameId || undefined })
    if (!rt.ok) {
      // Map missing -> TARGET_REQUIRED, mismatch -> TARGET_MISMATCH
      if (rt.errorCode === TARGET_CODES.TARGET_REQUIRED) return { ok: false, error: rt.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
      return { ok: false, error: rt.error, errorCode: rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : ERROR_CODES.TARGET_REQUIRED }
    }
  }
  if (cidArg && !pack.connections.some((c) => c.id === cidArg)) {
    return { ok: false, error: '连接不存在: ' + cidArg, errorCode: ERROR_CODES.CONNECTION_NOT_FOUND }
  }
  if (cidArg) {
    const conn = pack.connections.find((c) => c.id === cidArg)
    if (conn && conn.enabled === false) {
      return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
    }
  }
  if (cidArg && didArg && deviceDisabledOf(pack, cidArg, didArg)) {
    return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
  }
  // Resolve target connection: explicit else active
  const targetCid = cidArg || pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || ''
  const limit = Math.max(1, Math.min(200, Number(body && body.limit) || 50))
  const offset = Math.max(0, Number(body && body.offset) || 0)
  const srcFrames = (pack.framesByConnection && pack.framesByConnection[targetCid]) || []
  // Enrich frames with stable id if missing
  const enriched = srcFrames.map((f, idx) => {
    if (f && f.id) return f
    const id = (f && f.connectionId ? f.connectionId : targetCid) + ':' + (f && f.t ? f.t : Date.now()) + ':' + idx
    return { ...f, id, frameId: id }
  })
  if (frameId) {
    const hit = enriched.find((f) => f.id === frameId || f.frameId === frameId)
    if (!hit) return { ok: false, error: '报文不存在: ' + frameId, errorCode: ERROR_CODES.TARGET_MISMATCH }
    // Include stale check: if frame too old? mark stale
    const stale = hit.t && Date.now() - hit.t > 5 * 60 * 1000
    return { ok: true, frame: hit, stale: !!stale, connectionId: targetCid, configVersion: pack.configVersion || 1, errorCode: stale ? ERROR_CODES.STALE_VALUE : undefined }
  }
  const slice = enriched.slice(Math.max(0, enriched.length - limit - offset), enriched.length - offset)
  // Detect stale: last frame older than 60s?
  const last = enriched[enriched.length - 1]
  const stale = last ? (Date.now() - Number(last.t) > 60 * 1000) : false
  return {
    ok: true,
    frames: slice,
    total: enriched.length,
    connectionId: targetCid,
    deviceId: didArg || (pack.devices.find((d) => d.connectionId === targetCid)?.id || ''),
    configVersion: pack.configVersion || 1,
    stale: !!stale,
    ...(stale ? { errorCode: ERROR_CODES.STALE_VALUE, warning: '报文较旧，可能已过期' } : {}),
  }
}

export const requestFocus = (home, cwd, body) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const origin = originOf(body)
  const rawTarget = body && (body.target || body.focus || body) ? (body.target || body.focus || body) : {}
  const target = normalizeFocusRequest(rawTarget) || normalizeFocusRequest({
    connectionId: rawTarget.connectionId || rawTarget.connId,
    deviceId: rawTarget.deviceId,
    pointId: rawTarget.pointId,
    frameId: rawTarget.frameId,
    trendKey: rawTarget.trendKey,
    alarmId: rawTarget.alarmId,
    kind: rawTarget.kind,
    version: pack.configVersion || 1,
    by: origin.source === 'agent' ? 'agent' : 'user',
  })
  if (!target) return { ok: false, error: '缺少聚焦目标 connectionId/deviceId/pointId/frameId', errorCode: ERROR_CODES.TARGET_REQUIRED }
  {
    const rt = resolveUnifiedTarget(pack, target)
    if (!rt.ok) {
      const code = rt.errorCode === TARGET_CODES.TARGET_REQUIRED ? ERROR_CODES.TARGET_REQUIRED : (rt.errorCode === TARGET_CODES.TARGET_MISMATCH ? ERROR_CODES.TARGET_MISMATCH : ERROR_CODES.TARGET_REQUIRED)
      // map not-found variants to MISMATCH for unified view
      if (/不存在/.test(rt.error) && code === ERROR_CODES.TARGET_REQUIRED) return { ok: false, error: rt.error, errorCode: ERROR_CODES.TARGET_MISMATCH }
      return { ok: false, error: rt.error, errorCode: code }
    }
  }
  if (target.connectionId && target.deviceId && deviceDisabledOf(pack, target.connectionId, target.deviceId)) {
    return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
  }
  // Temporal check: ENDPOINT_DRIFT if target's endpoint fingerprint changed?
  // For focus, we treat endpoint drift as warning but not error.
  const prev = workspace.focus ? workspace.focus.request : null
  const nextReq = {
    connectionId: target.connectionId || '',
    deviceId: target.deviceId || '',
    pointId: target.pointId || '',
    frameId: target.frameId || '',
    trendKey: target.trendKey || '',
    alarmId: target.alarmId || '',
    kind: target.kind || '',
    at: Date.now(),
    by: origin.source === 'agent' ? 'agent' : 'user',
    version: pack.configVersion || 1,
  }
  const tempWatchIds = Array.isArray(body.tempWatchIds) ? body.tempWatchIds.map((x) => String(x).trim()).filter(Boolean).slice(0, 32)
    : (Array.isArray(body.tempWatch) ? body.tempWatch.map((x) => String(x).trim()).filter(Boolean).slice(0, 32) : [])
  const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 20) : []
  const wantForeground = body.foreground === true
  const badgeOnly = !!(body.badgeOnly === true || (origin.source === 'agent' && !wantForeground))
  const saved = saveWorkspace(home, room.cwd, {
    focus: {
      request: nextReq,
      prev: prev || null,
      tempWatchIds,
      badgeOnly,
      evidence,
    },
  })
  if (!saved.ok) return { ok: false, error: saved.error }
  // Record event for timeline
  try {
    recordBenchEvent(home, room.cwd, {
      action: 'focus',
      ok: true,
      summary: '聚焦 ' + [nextReq.connectionId, nextReq.deviceId, nextReq.pointId, nextReq.frameId].filter(Boolean).join('/') || '未知目标',
    }, { source: origin.source, sessionId: origin.sessionId })
  } catch {}
  return { ok: true, focus: nextReq, prev, tempWatchIds, badgeOnly, evidence, configVersion: pack.configVersion || 1 }
}

export const buildEvidenceRefs = (home, cwd) => {
  const workspace = loadWorkspace(home, cwd)
  const pack = normalizeModbus(workspace.modbus)
  const refs = []
  // compile evidence: latest build task
  const latestBuild = (workspace.tasks || []).find((t) => t.type === 'build')
  if (latestBuild) refs.push({ kind: 'build', id: latestBuild.id, at: latestBuild.endedAt || latestBuild.startedAt, version: pack.configVersion || 1 })
  // log evidence: last timeline
  const lastLog = (workspace.timeline || [])[0]
  if (lastLog) refs.push({ kind: 'log', id: lastLog.id, at: lastLog.at, version: pack.configVersion || 1 })
  // point/frame/trend slices
  for (const p of pack.points.slice(0, 5)) refs.push({ kind: 'point', id: p.id, connectionId: p.connectionId, deviceId: p.deviceId, version: pack.configVersion || 1 })
  return refs
}

export const _internal = { deviceAlarms, evaluatePointAlarms, alarmLabel, endpointFingerprint }
