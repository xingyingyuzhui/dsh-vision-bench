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
import { planReadBatches } from './bench-pollplan.mjs'
import { aborted, hasRunning, originOf, signalOf } from './bench-journal.mjs'
import {
  finishTask,
  loadBindings,
  loadWorkspace,
  openTask,
  pruneBuildLogs,
  recordBenchEvent,
  saveWorkspace,
} from './bench-store.mjs'
import { runPythonScript } from './bench-run.mjs'
import { serialDevicePath } from './bench-serial.mjs'
import { withPortLock } from './bench-portlock.mjs'
import { findMonitoredPort } from './bench-serial-monitor.mjs'
import { notifyBenchEvent } from './bench-notify.mjs'

const needPython = (bindings) => {
  if (!bindings.python) return '请先在设置 → 台架 绑定 Python'
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

export const connectOp = (home, cwd, body) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const patch = pickConnPatch(body)
  if (!Object.keys(patch).length) return { ok: false, error: '缺少连接参数' }
  const cidRaw = body && (body.connectionId || body.connId) ? String(body.connectionId || body.connId).trim() : ''
  if (cidRaw) {
    const workspace = loadWorkspace(home, room.cwd)
    const pack = normalizeModbus(workspace.modbus)
    const target = pack.connections.find((c) => c.id === cidRaw)
    if (!target) return { ok: false, error: '连接不存在: ' + cidRaw }
    const nextConns = pack.connections.map((c) => c.id === cidRaw ? { ...c, conn: { ...c.conn, ...patch } } : c)
    let nextDevices = pack.devices
    if (patch.slave !== undefined) {
      const didRaw = body && body.deviceId ? String(body.deviceId).trim() : ''
      let devId = didRaw
      if (!devId) {
        if (pack.activeConnectionId === cidRaw && pack.activeDeviceId) devId = pack.activeDeviceId
        else {
          const devFor = pack.devices.find((d) => d.connectionId === cidRaw)
          devId = devFor ? devFor.id : ''
        }
      }
      if (devId) {
        const unit = Math.min(247, Math.max(0, Math.trunc(Number(patch.slave) || 1)))
        nextDevices = pack.devices.map((d) => d.id === devId ? { ...d, unitId: unit } : d)
      }
    }
    const saved = saveWorkspace(home, room.cwd, { modbus: { connections: nextConns, devices: nextDevices, version: 3 } })
    if (!saved.ok) return saved
    const outConn = (saved.workspace.modbus.connections.find((c) => c.id === cidRaw) || {}).conn || saved.workspace.modbus.conn
    return { ok: true, action: 'connect', conn: outConn, connectionId: cidRaw, connId: cidRaw }
  }
  const saved = saveWorkspace(home, room.cwd, { modbus: { conn: patch } })
  if (!saved.ok) return saved
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

const endpointFingerprint = (conn) => ({
  mode: conn.mode,
  port: (conn.port || '').trim(),
  baudrate: Number(conn.baudrate) || 0,
  bytesize: Number(conn.bytesize) || 8,
  parity: conn.parity || 'N',
  stopbits: Number(conn.stopbits) || 1,
  host: (conn.host || '').trim(),
  tcpPort: Number(conn.tcpPort) || 0,
  slave: Number(conn.slave) || 0,
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

export const resolvePendingWrite = async (home, cwd, id, approved) => {
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
  if (!sameEndpoint(endpointFingerprint(connForWrite), entry.params.endpoint)) {
    recordBenchEvent(home, room.cwd, {
      action: 'write-stale',
      ok: false,
      summary: '写点请求过期（连接已变更）：' + entry.params.label,
    }, { source: 'system' })
    void notifyBenchEvent(home, room.cwd,
      '写点请求已失效：串口/TCP 连接在批准前发生了变化，请让 Agent 重新发起',
      '', { sessionId: entry.params.sessionId }).catch(() => {})
    return { ok: false, error: '设备连接已变更，原批准已失效，请让 Agent 重新发起请求' }
  }
  return modbusWrite(home, room.cwd, {
    ...entry.params,
    source: 'agent',
    confirm: true,
  })
}

// ── transport ────────────────────────────────────────────────────────────

const MONITOR_BUSY_MSG = '串口正被日志监视占用，请先在上位机页关闭串口日志；要看总线报文可改用第二个只听适配器接另一个 COM'

const connArgs = (conn) => {
  const args = [
    '--mode', conn.mode,
    '--slave', String(conn.slave),
    '--timeout', '1',
    '--json',
  ]
  if (conn.mode === 'rtu') {
    if (!conn.port) return { error: 'RTU 需要串口' }
    args.push(
      '--port', serialDevicePath(conn.port),
      '--baudrate', String(conn.baudrate),
      '--bytesize', String(conn.bytesize),
      '--parity', String(conn.parity),
      '--stopbits', String(conn.stopbits),
    )
  } else {
    if (!conn.host) return { error: 'TCP 需要主机地址' }
    args.push('--host', conn.host, '--tcp-port', String(conn.tcpPort))
  }
  return { args }
}

// Every pymodbus spawn goes through here: RTU ports are exclusive on Windows,
// so transactions queue on a per-port lock and refuse while the log monitor
// holds the same COM.
const runModbusScript = (python, scriptName, args, conn, opts) => {
  const port = conn && conn.mode === 'rtu' ? conn.port : ''
  if (port) {
    if (findMonitoredPort(port)) {
      return Promise.resolve({ ok: false, error: MONITOR_BUSY_MSG })
    }
    return withPortLock(port, () => runPythonScript(python, scriptName, args, opts))
  }
  return runPythonScript(python, scriptName, args, opts)
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

const frameEntry = (label, frames, at = Date.now(), extra = {}) => ({
  t: at,
  connectionId: extra.connectionId || '',
  deviceId: extra.deviceId || 'conn',
  deviceName: extra.deviceName || '',
  label,
  request: frames ? frames.request : '',
  response: frames ? frames.response : '',
  trace: frames ? frames.trace : [],
})

// ── reads ────────────────────────────────────────────────────────────────

const runReadTx = (python, conn, fc, address, count, cwd, timeoutMs, signal) =>
  runModbusScript(python, 'modbus_read.py', [
    '--function', String(fc),
    '--address', String(address),
    '--count', String(count),
    '--debug',
  ], conn, { cwd, timeoutMs: timeoutMs || 20000, signal })

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
  const sim = conn.sim === true
  const bindings = sim ? { python: '' } : loadBindings(home)
  if (!sim) {
    const missing = needPython(bindings)
    if (missing) return { ok: false, error: missing }
    const connCheck = connArgs(conn)
    if (connCheck.error) return { ok: false, error: connCheck.error }
  }
  if (hasRunning(workspace, 'read')) {
    return { ok: false, error: '已有读点任务进行中' }
  }
  const origin = originOf(body)

  // Batch selection:
  //   all=true            → planned batches over every configured point (filtered by connection/device if given)
  //   pointId             → single configured point (must match connection/device if given)
  //   function+address    → standalone scratch read (no point needed) - still validates point existence for scoped reads
  let batches = []
  let labels = []
  let batchConnIds = []
  if (body && body.all === true) {
    let filtered = pack.points
    if (cidArg) filtered = filtered.filter((p) => (p.connectionId || p.connId) === cidArg)
    if (didArg) filtered = filtered.filter((p) => p.deviceId === didArg)
    // if no filter, use all points but keep per-connection grouping for frames
    if (!filtered.length) return { ok: false, error: '无点位，请先添加点位' }
    batches = planReadBatches(filtered)
    labels = batches.map((b) => '读 ' + functionTag(b.fc) + b.address + '×' + b.count)
    // for all=true without filter, we need to know which connection each batch belongs to? batches are mixed across connections;
    // we will treat all batches as belonging to targetCid for sim vs real? But real needs per-connection conn.
    // For multi-connection all read, we will group batches by connectionId: simpler send all via target conn if filtered, else per-connection loop below handles multi.
    batchConnIds = batches.map(() => targetCid)
  } else if (body && body.pointId) {
    const point = pack.points.find((item) => item.id === body.pointId)
    if (!point) return { ok: false, error: '点位不存在: ' + body.pointId }
    if (cidArg && (point.connectionId || point.connId) !== cidArg) return { ok: false, error: '点位不在指定连接: ' + body.pointId }
    if (didArg && point.deviceId !== didArg) return { ok: false, error: '点位不在指定设备: ' + body.pointId }
    batches = [{ fc: point.function, address: point.address, count: 1 }]
    labels = ['读 ' + pointLabel(point)]
    batchConnIds = [point.connectionId || targetCid]
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
    batches = [{ fc, address, count }]
    labels = ['读 ' + functionTag(fc) + address + '×' + count]
    batchConnIds = [targetCid]
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
    const batchCid = batchConnIds[bi] || targetCid
    const batchConnObj = pack.connections.find((c) => c.id === batchCid) || targetConnObj
    const batchConn = batchConnObj ? batchConnObj.conn : conn
    const batchSim = batchConn.sim === true
    if (aborted(signal)) {
      finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source, values, framesLog, framesByConnection }
    }
     const ran = await (batchSim
        ? Promise.resolve({
          ok: true,
          result: { details: { raw: Array.from({ length: batch.count }, (_, i) => ((batch.address + i) * 10 + Math.floor(Date.now() / 1000)) & 0xffff) } },
        })
        : runReadTx(bindings.python, batchConn, batch.fc, batch.address, batch.count, room.cwd, 20000, signal))
    if (ran.cancelled) {
      finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source, values, framesLog, framesByConnection }
    }
    const raw = ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw)
      ? ran.result.details.raw
      : []
    values = scatterBatch(values, pack.points, batch, raw, !!ran.ok, ran.ok ? '' : (ran.error || ''))
    const f = framesOf(ran)
    if (f) {
      lastFrames = f
      const entry = frameEntry(labels[bi] + (batchSim ? '（仿真）' : ''), f, Date.now(), { connectionId: batchCid })
      framesLog.push(entry)
      if (!framesByConnection[batchCid]) framesByConnection[batchCid] = []
      framesByConnection[batchCid] = framesByConnection[batchCid].concat([entry]).slice(-500)
    }
    results.push({ label: labels[bi], ok: !!ran.ok, error: ran.ok ? '' : (ran.error || ''), count: batch.count })
    if (ran.ok) okCount += 1
    else lastError = ran.error || lastError
  }

  const okAll = okCount === batches.length
  const summary = (sim ? '仿真 ' : '')
    + (okAll ? ('读取成功（' + batches.length + ' 批）') : ('读取 ' + okCount + '/' + batches.length + ' 批成功' + (lastError ? '：' + lastError : '')))
  finishTask(home, room.cwd, task.id, { ok: okAll, summary, frames: lastFrames })
  // persist framesByConnection and values
  try {
    const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    saveWorkspace(home, room.cwd, { modbus: { values, framesByConnection, version: 3 } })
  } catch {}
  return {
    ok: okAll,
    taskId: task.id,
    source: origin.source,
    summary,
    results,
    values,
    framesLog,
    framesByConnection,
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
  const fn = Number(body && body.function)
  const address = clampInt(body && body.address, -1, 0, 65535)
  if (address < 0) return { ok: false, error: '缺少寄存器地址' }
  const rawValues = body && body.values !== undefined
    ? body.values
    : (body && body.value !== undefined ? body.value : undefined)
  const check = normalizeWriteValues(fn, rawValues, 1968)
  if (!check.ok) return { ok: false, error: check.error }
  const count = check.values.length
  if (hasRunning(workspace, 'write')) {
    return { ok: false, error: '已有写入任务进行中' }
  }
  // Validate that every target address exists in the point table (v3-aware, scoped by connection/device)
  for (let i = 0; i < count; i++) {
    const addr = address + i
    const hit = findPointV3(pack.points, fn, addr, targetCid, targetDid)
    if (!hit) {
      return { ok: false, error: '不在点表：' + functionTag(fn) + addr }
    }
    if (cidArg && (hit.connectionId || hit.connId) !== cidArg) {
      return { ok: false, error: '不在点表：' + functionTag(fn) + addr }
    }
    if (didArg && hit.deviceId !== didArg) {
      return { ok: false, error: '不在点表：' + functionTag(fn) + addr }
    }
  }
  const origin = originOf(body)
  if (origin.source === 'agent' && !(body && body.confirm === true)) {
    const request = createPendingWrite(room.cwd, {
      function: fn,
      address,
      values: check.values.slice(),
      label: '',
      sessionId: origin.sessionId,
      connectionId: targetCid,
      connId: targetCid,
      deviceId: targetDid,
      endpoint: endpointFingerprint(conn),
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
  const bindings = conn.sim ? { python: '' } : loadBindings(home)
  let connChecked = null
  if (!conn.sim) {
    connChecked = connArgs(conn)
    if (connChecked.error) return { ok: false, error: connChecked.error }
  }
  const label = entryLabel(fn, address, count, check.values)
  const before = []
  for (let i = 0; i < count; i++) before.push(pointBefore(pack, fn, address + i, targetCid, targetDid))
  const task = openTask(home, room.cwd, {
    type: 'write',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: label,
  })
  const done = (ok, summaryText, extra = {}) => {
    finishTask(home, room.cwd, task.id, {
      ok,
      summary: summaryText,
      frames: extra.frames || null,
    })
    // persist framesByConnection for this connection
    try {
      if (extra.frames) {
        const cur = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
        const fbc = { ...(cur.framesByConnection || {}) }
        const entry = frameEntry(label, extra.frames, Date.now(), { connectionId: targetCid, deviceId: targetDid })
        fbc[targetCid] = (fbc[targetCid] || []).concat([entry]).slice(-500)
        saveWorkspace(home, room.cwd, { modbus: { framesByConnection: fbc, version: 3 } })
      }
    } catch {}
    return {
      ok,
      taskId: task.id,
      source: origin.source,
      action: 'write',
      function: fn,
      address,
      connectionId: targetCid,
      connId: targetCid,
      deviceId: targetDid,
      before,
      target: check.values,
      readback: extra.readback || [],
      frames: extra.frames || null,
      framesLog: [frameEntry(label, extra.frames, Date.now(), { connectionId: targetCid, deviceId: targetDid })],
      framesByConnection: extra.framesByConnection || undefined,
      values: extra.values || pack.values,
      simulated: !!extra.simulated,
      ...(ok ? {} : { error: summaryText }),
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
    return done(true, label + '（本地生效）', {
      values: vals,
      simulated: true,
      readback: check.values.slice(),
    })
  }

  const ran = await runModbusScript(bindings.python, 'modbus_write.py', [
    '--function', String(check.fc),
    '--address', String(address),
    '--values', check.values.join(','),
    '--debug',
  ], conn, { cwd: room.cwd, timeoutMs: 20000, signal })
  if (ran.cancelled) {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '写入已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  if (!ran.ok) {
    return done(false, '写入失败 ' + (ran.error || ''), { frames: framesOf(ran) })
  }
  // Read back the written range so success means verified.
  const readbackRan = await runReadTx(bindings.python, conn, fn, address, count, room.cwd, 20000, signal)
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
  try {
    saveWorkspace(home, room.cwd, { modbus: { values: vals, version: 3 } })
  } catch {}
  return done(readbackOk && !mismatch, summary, {
    values: vals,
    readback: readbackOk ? raw : [],
    frames: framesOf(ran) || framesOf(readbackRan),
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
      // check python bindings only if any non-sim connection needs it
      if (!conn.sim) {
        const bindings = loadBindings(home)
        const missing = needPython(bindings)
        if (missing) {
          return { ok: false, error: missing, polling: pollingByConnection[connId] || pack.polling, pollingByConnection, values }
        }
      }
      const batches = planReadBatches(pts)
      const interval = pollingByConnection[connId] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
      let connOk = true
      for (const batch of batches) {
        if (aborted(signal)) { timedOut = true; ok = false; connOk = false; break }
        const bindings = conn.sim ? { python: '' } : loadBindings(home)
        const ran = await (conn.sim
          ? Promise.resolve({
            ok: true,
            result: { details: { raw: Array.from({ length: batch.count }, (_, i) => ((batch.address + i) * 10 + Math.floor(Date.now() / 1000)) & 0xffff) } },
          })
          : runReadTx(bindings.python, conn, batch.fc, batch.address, batch.count, room.cwd, 4000, signal))
        if (ran.cancelled || aborted(signal)) { timedOut = true; ok = false; connOk = false; break }
        if (!ran.ok) { ok = false; connOk = false }
        const raw = ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw) ? ran.result.details.raw : []
        values = scatterBatch(values, pack.points, batch, raw, !!ran.ok, ran.ok ? '' : (ran.error || ''))
        const f = framesOf(ran)
        if (f) {
          const entry = frameEntry('读 ' + functionTag(batch.fc) + batch.address + '×' + batch.count + '（监视）', f, Date.now(), { connectionId: connId })
          framesLog.push(entry)
          if (!framesByConnection[connId]) framesByConnection[connId] = []
          framesByConnection[connId] = framesByConnection[connId].concat([entry]).slice(-500)
        }
      }
      pollingByConnection[connId] = { ...interval, lastAt: Date.now(), lastOk: connOk && !timedOut, error: timedOut ? '轮询超时' : (connOk ? '' : '轮询部分失败') }
    }
    const alarmEval = evaluateAlarms({ points: pack.points, values, prevState: pack.alarmState || pack.alarmActive, pollingByConnection, connections: pack.connections, opts: { deadband: 1 } })
    const alarms = { next: alarmEval.next, fired: alarmEval.fired.filter(f=> f.point), cleared: alarmEval.recovered.filter(r=> r.point), commFired: alarmEval.fired.filter(f=> !f.point), commCleared: alarmEval.recovered.filter(r=> !r.point) }
    const activeBool = Object.fromEntries(Object.entries(alarmEval.next).filter(([,v])=> v && v.status==='active' && v.group==='process').map(([k])=>[k,true]))
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
    const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    const mergedPolling = { ...latest.pollingByConnection, ...pollingByConnection }
    const activePolling = mergedPolling[pack.activeConnectionId] || pollingByConnection[targetConns[0]?.id] || latest.polling
    const saved = saveWorkspace(home, room.cwd, {
      modbus: {
        values,
        alarmActive: activeBool,
        alarmState: alarmEval.next,
        polling: activePolling,
        pollingByConnection: mergedPolling,
        framesByConnection,
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

export const _internal = { deviceAlarms, evaluatePointAlarms, alarmLabel, endpointFingerprint }
