import { applyPointWrite, applySegmentRead, clampInt, decodeValue, evaluateAlarm, functionTag, normalizeSegments, normalizeWriteValues, segmentCovering, simulateSegmentRan } from './bench-points.mjs'
import { activeDevice, normalizeModbus } from './bench-devices.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { finishTask, loadBindings, loadWorkspace, openTask, recordBenchEvent, saveWorkspace } from './bench-store.mjs'
import { aborted, hasRunning, originOf, signalOf } from './bench-journal.mjs'

import { runPythonScript } from './bench-run.mjs'
import { serialDevicePath } from './bench-serial.mjs'
import { withPortLock } from './bench-portlock.mjs'
import { findMonitoredPort } from './bench-serial-monitor.mjs'
import { notifyBenchEvent } from './bench-notify.mjs'

const pollLocks = new Map()
const POLL_BUDGET_MS = 30000

const MODBUS_PATCH_KEYS = ['mode', 'port', 'host', 'tcpPort', 'slave', 'baudrate', 'function', 'address', 'count', 'sim', 'timeoutSec']

export const pickModbusPatch = (raw) => {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of MODBUS_PATCH_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}

const connectionArgs = (m) => {
  const args = [
    '--mode', m.mode,
    '--slave', String(m.slave),
    '--timeout', String(m.timeoutSec),
    '--json',
  ]
  if (m.mode === 'rtu') {
    if (!m.port) return { error: 'RTU 需要串口' }
    args.push('--port', serialDevicePath(m.port), '--baudrate', String(m.baudrate))
  } else {
    if (!m.host) return { error: 'TCP 需要主机地址' }
    args.push('--host', m.host, '--tcp-port', String(m.tcpPort))
  }
  return { args }
}


const MONITOR_BUSY_MSG = '串口正被日志监视占用，请先在调试页关闭串口日志；要看总线报文可改用第二个只听适配器接另一个 COM'

// Every pymodbus spawn goes through here: RTU ports are exclusive on Windows,
// so transactions queue on a per-port lock and refuse while the log monitor
// holds the same COM.
const runModbusScript = (python, scriptName, args, port, opts) => {
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


const runSegment = (python, conn, segment, cwd, timeoutMs, signal, port) => runModbusScript(python, 'modbus_read.py', conn.concat([
  '--function', String(segment.function),
  '--address', String(segment.address),
  '--count', String(segment.count),
  '--debug',
]), port, { cwd, timeoutMs: timeoutMs || 20000, signal })


const readSegmentsSim = (m, list) => {
  const at = Date.now()
  let values = m.values || []
  const results = []
  for (const segment of list) {
    values = applySegmentRead(values, segment, simulateSegmentRan(segment, at))
    results.push({ segmentId: segment.id, ok: true, error: '', count: segment.count })
  }
  return { ok: true, values, okCount: list.length, results, error: '', simulated: true }
}


const readSegments = async (python, m, list, cwd, timeoutMs, signal) => {
  if (m.role === 'slave') return m.sim ? readSegmentsSim(m, list) : { ok: true, values: m.values || [], okCount: list.length, results: [], error: '' }
  if (m.sim) return readSegmentsSim(m, list)
  const conn = connectionArgs(m)
  if (conn.error) return { ok: false, error: conn.error, values: m.values || [], okCount: 0 }
  let values = m.values || []
  let okCount = 0
  let lastError = ''
  let lastFrames = null
  const results = []
  const port = m.mode === 'rtu' ? m.port : ''
  for (const segment of list) {
    if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消', values, okCount, results }
    const ran = await runSegment(python, conn.args, segment, cwd, timeoutMs, signal, port)
    if (ran.cancelled) return { ok: false, cancelled: true, error: '已取消', values, okCount, results }
    values = applySegmentRead(values, segment, ran)
    lastFrames = framesOf(ran) || lastFrames
    results.push({
      segmentId: segment.id,
      ok: !!ran.ok,
      error: ran.ok ? '' : (ran.error || ''),
      count: segment.count,
    })
    if (ran.ok) okCount += 1
    else lastError = ran.error || lastError
  }
  return {
    ok: okCount === list.length,
    values,
    okCount,
    results,
    frames: lastFrames,
    error: lastError,
  }
}


export const modbusRead = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const workspace = loadWorkspace(home, room.cwd)
  const patch = pickModbusPatch(body && body.modbus)
  const saved = Object.keys(patch).length
    ? saveWorkspace(home, room.cwd, { keil: workspace.keil, modbus: patch })
    : { ok: true, workspace }
  if (!saved.ok) return saved
  const pack = normalizeModbus(saved.workspace.modbus)
  const device = (body && body.deviceId)
    ? (pack.devices.find((item) => item.id === body.deviceId) || activeDevice(pack))
    : activeDevice(pack)
  const m = device
  const sim = m.sim === true
  const bindings = sim ? { python: '' } : loadBindings(home)
  if (!sim && m.role !== 'slave') {
    const missing = needPython(bindings)
    if (missing) return { ok: false, error: missing }
    const conn = connectionArgs(m)
    if (conn.error) return { ok: false, error: conn.error }
  }
  if (hasRunning(saved.workspace, 'read')) {
    return { ok: false, error: '已有读点任务进行中' }
  }
  const origin = originOf(body)
  const table = body && (body.all === true || body.segmentId)
  if (table) {
    const all = normalizeSegments(m.segments)
    const list = body.segmentId ? all.filter((item) => item.id === body.segmentId) : all
    if (!list.length) return { ok: false, error: '无寄存器段' }
    const task = openTask(home, room.cwd, {
      type: 'read',
      source: origin.source,
      sessionId: origin.sessionId,
      summary: list.length === 1
        ? ('读段 ' + (list[0].name || ('f' + list[0].function + '@' + list[0].address)))
        : ('读点表 ' + list.length + ' 段'),
    })
    const ran = await readSegments(bindings.python, m, list, room.cwd, 20000, signal)
    if (ran.cancelled) {
      finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source }
    }
    const summary = (sim ? '仿真 ' : '') + (ran.ok
      ? ('读取 ' + list.length + ' 段成功')
      : ('读取 ' + ran.okCount + '/' + list.length + ' 段成功' + (ran.error ? '：' + ran.error : '')))
    const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    const devices = latest.devices.map((item) => item.id === m.id ? { ...item, values: ran.values } : item)
    finishTask(home, room.cwd, task.id, { ok: ran.ok, summary, frames: ran.frames || null, modbus: { devices, activeId: latest.activeId } })
    return {
      ok: ran.ok,
      taskId: task.id,
      source: origin.source,
      summary,
      results: ran.results,
      values: ran.values,
      simulated: sim,
      error: ran.ok ? undefined : ran.error,
    }
  }

  if (sim) {
    const segment = { id: 'single', function: m.function, address: m.address, count: m.count }
    const ran = simulateSegmentRan(segment)
    const raw = ran.result.details.raw
    const value = raw.length === 1 ? raw[0] : raw
    const task = openTask(home, room.cwd, {
      type: 'read',
      source: origin.source,
      sessionId: origin.sessionId,
      summary: '仿真读 f' + m.function + '@' + m.address,
    })
    const summary = '仿真读 f' + m.function + '@' + m.address + ' = ' + JSON.stringify(value)
    finishTask(home, room.cwd, task.id, { ok: true, summary })
    return { ok: true, taskId: task.id, source: origin.source, simulated: true, result: { summary, details: { raw, value } } }
  }

  const conn = connectionArgs(m)
  if (conn.error) return { ok: false, error: conn.error }
  const args = conn.args.concat([
    '--function', String(m.function),
    '--address', String(m.address),
    '--count', String(m.count),
    '--debug',
  ])
  const task = openTask(home, room.cwd, {
    type: 'read',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: 'Modbus 读 f' + m.function + '@' + m.address,
  })
  const ran = await runModbusScript(bindings.python, 'modbus_read.py', args, m.mode === 'rtu' ? m.port : '', {
    cwd: room.cwd,
    timeoutMs: 20000,
    signal,
  })
  if (ran.cancelled) {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '读取已取消' })
    return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source }
  }
  const value = ran.result && ran.result.details && ran.result.details.value
  const summary = ran.ok
    ? ('Modbus 读 f' + m.function + '@' + m.address + ' = ' + JSON.stringify(value))
    : ('Modbus 读失败 ' + (ran.error || ''))
  finishTask(home, room.cwd, task.id, { ok: !!ran.ok, summary, frames: framesOf(ran) })
  return { ...ran, taskId: task.id, source: origin.source }
}


const pointBefore = (device, fn, address) => {
  const segment = segmentCovering(device.segments, fn, address)
  if (!segment) return null
  const recs = Array.isArray(device.values) ? device.values : []
  const key = String(segment.id) + ':' + String(fn) + '@' + String(address)
  const rec = recs.find((item) => item.key === key)
  return rec && rec.value !== null && rec.value !== undefined ? rec.value : null
}


const PENDING_TTL_MS = 5 * 60 * 1000
const pendingWrites = new Map()
let pendingSeq = 0

export const createPendingWrite = (cwd, params) => {
  const id = 'pw' + Date.now().toString(36) + (++pendingSeq).toString(36)
  pendingWrites.set(cwd + ':' + id, {
    id,
    cwd,
    createdAt: Date.now(),
    params,
  })
  prunePendingWrites(cwd)
  return { id, ...params }
}

export const popPendingWrite = (cwd, id) => {
  prunePendingWrites(cwd)
  const key = String(cwd) + ':' + String(id || '')
  const entry = pendingWrites.get(key)
  if (!entry) return null
  pendingWrites.delete(key)
  return entry
}

export const listPendingWrites = (cwd) => {
  prunePendingWrites(cwd)
  const out = []
  for (const entry of pendingWrites.values()) {
    if (entry.cwd === cwd) out.push({ id: entry.id, ...entry.params })
  }
  return out
}

const prunePendingWrites = (cwd) => {
  const now = Date.now()
  void cwd
  for (const [key, entry] of pendingWrites) {
    if (now - entry.createdAt > PENDING_TTL_MS) {
      pendingWrites.delete(key)
    }
  }
}


const endpointFingerprint = (m) => ({
  mode: m.mode,
  port: (m.port || '').trim(),
  host: (m.host || '').trim(),
  tcpPort: Number(m.tcpPort) || 0,
  slave: Number(m.slave) || 0,
  baudrate: Number(m.baudrate) || 0,
})

export const endpointLabel = (m) => m.mode === 'rtu'
  ? ((m.port || '?') + ' @ ' + (m.baudrate || 0) + ' · 站号 ' + (m.slave || 0))
  : ((m.host || '?') + ':' + (m.tcpPort || 0) + ' · 站号 ' + (m.slave || 0))

const sameEndpoint = (a, b) =>
  !!a && !!b
    && a.mode === b.mode
    && a.port === b.port
    && a.host === b.host
    && a.tcpPort === b.tcpPort
    && a.slave === b.slave
    && a.baudrate === b.baudrate

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
  // The user approved a write to the endpoint they saw on the card. If the
  // device connection changed since, refuse instead of writing somewhere else.
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const device = pack.devices.find((item) => item.id === entry.params.deviceId)
  if (!device) {
    return { ok: false, error: '请求的目标设备已不存在，请让 Agent 重新发起请求' }
  }
  if (!sameEndpoint(endpointFingerprint(device), entry.params.endpoint)) {
    recordBenchEvent(home, room.cwd, {
      action: 'write-stale',
      ok: false,
      summary: '写点请求过期（设备连接已变更）：' + entry.params.label,
    }, { source: 'system' })
    void notifyBenchEvent(home, room.cwd,
      '写点请求已失效：设备连接在批准前发生了变化，请让 Agent 重新发起',
      '', { sessionId: entry.params.sessionId }).catch(() => {})
    return { ok: false, error: '设备连接已变更，原批准已失效，请让 Agent 重新发起请求' }
  }
  return modbusWrite(home, room.cwd, {
    ...entry.params,
    source: 'agent',
    confirm: true,
  })
}


export const modbusWrite = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  // A pending approval must execute on the exact device it showed the user;
  // only requests without an explicit deviceId may fall back to the active one.
  let device = null
  if (body && body.deviceId) {
    device = pack.devices.find((item) => item.id === body.deviceId) || null
    if (!device) return { ok: false, error: '请求的目标设备已不存在' }
  } else {
    device = activeDevice(pack)
  }
  const m = device
  const fn = Number(body && body.function)
  const address = clampInt(body && body.address, -1, 0, 65535)
  if (address < 0) return { ok: false, error: '缺少寄存器地址' }
  const rawValues = body && body.values !== undefined
    ? body.values
    : (body && body.value !== undefined ? body.value : undefined)
  const check = normalizeWriteValues(fn, rawValues, 1968)
  if (!check.ok) return { ok: false, error: check.error }
  const count = check.values.length
  const local = m.sim === true || m.role === 'slave'
  if (local) {
    for (let i = 0; i < count; i++) {
      if (!segmentCovering(m.segments, fn, address + i)) {
        return { ok: false, error: '地址 ' + (address + i) + ' 不在点表段内' }
      }
    }
  }
  if (hasRunning(workspace, 'write')) {
    return { ok: false, error: '已有写入任务进行中' }
  }
  const origin = originOf(body)
  const bindings = m.sim ? { python: '' } : loadBindings(home)
  let conn = null
  if (!m.sim) {
    conn = connectionArgs(m)
    if (conn.error) return { ok: false, error: conn.error }
  }
  const tag = functionTag(fn)
  const label = count === 1
    ? ('写 ' + tag + address + ' = ' + check.values[0])
    : ('批量写 ' + tag + address + '–' + (address + count - 1) + '（' + count + ' 点）')
  if (origin.source === 'agent' && !(body && body.confirm === true)) {
    const request = createPendingWrite(room.cwd, {
      function: fn,
      address,
      values: check.values.slice(),
      deviceId: m.id,
      deviceName: m.name || '',
      label,
      sessionId: origin.sessionId,
      endpoint: endpointFingerprint(m),
      endpointLabelStr: endpointLabel(m),
    })
    return {
      ok: false,
      needsConfirm: true,
      requestId: request.id,
      request,
      error: 'Agent 写点是高影响操作，需要用户在界面上批准',
    }
  }
  const before = []
  for (let i = 0; i < count; i++) before.push(pointBefore(m, fn, address + i))
  const task = openTask(home, room.cwd, {
    type: 'write',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: label,
  })
  // Merge-only completion: reload the freshest device list and patch ONLY the
  // target device's values (and sim flag for local writes). A real write plus
  // readback can take tens of seconds; rebuilding the whole device array from
  // a pre-write snapshot would clobber concurrent config edits.
  const done = (ok, summary, extra = {}) => {
    const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    const devices = latest.devices.map((item) => {
      if (item.id !== m.id) return item
      return {
        ...item,
        values: extra.values !== undefined ? extra.values : item.values,
        sim: extra.exitSim ? false : item.sim,
      }
    })
    finishTask(home, room.cwd, task.id, {
      ok,
      summary,
      frames: extra.frames || null,
      modbus: { devices, activeId: latest.activeId },
    })
    return {
      ok,
      taskId: task.id,
      source: origin.source,
      action: 'write',
      function: fn,
      address,
      before,
      target: check.values,
      readback: extra.readback || [],
      frames: extra.frames || null,
      simulated: !!extra.simulated,
      ...(ok ? {} : { error: summary }),
    }
  }

  if (local) {
    const at = Date.now()
    let vals = Array.isArray(m.values) ? m.values : []
    for (let i = 0; i < count; i++) {
      const seg = segmentCovering(m.segments, fn, address + i)
      vals = applyPointWrite(vals, seg, address + i, check.values[i], at)
    }
    return done(true, label + '（本地生效）', {
      values: vals,
      exitSim: true,
      simulated: m.sim === true,
      readback: check.values.slice(),
    })
  }

  const writePort = m.mode === 'rtu' ? m.port : ''
  const ran = await runModbusScript(bindings.python, 'modbus_write.py', conn.args.concat([
    '--function', String(check.fc),
    '--address', String(address),
    '--values', check.values.join(','),
    '--debug',
  ]), writePort, { cwd: room.cwd, timeoutMs: 20000, signal })
  if (ran.cancelled) {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '写入已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  if (!ran.ok) {
    return done(false, '写入失败 ' + (ran.error || ''), { frames: framesOf(ran) })
  }
  const readbackRan = await runSegment(bindings.python, conn, { id: 'write-back', function: fn, address, count }, room.cwd, 20000, signal, writePort)
  const raw = readbackRan.ok && readbackRan.result && readbackRan.result.details && Array.isArray(readbackRan.result.details.raw)
    ? readbackRan.result.details.raw.slice(0, count)
    : []
  const readbackOk = readbackRan.ok && raw.length === count
  let vals = Array.isArray(m.values) ? m.values : []
  for (let i = 0; i < count; i++) {
    const seg = segmentCovering(m.segments, fn, address + i) || { id: 'write', function: fn, address: address + i, count: 1 }
    vals = applyPointWrite(vals, seg, address + i, raw[i] !== undefined ? raw[i] : null, Date.now())
  }
  const mismatch = readbackOk && raw.some((value, i) => Number(value) !== Number(check.values[i]))
  const summary = label + (readbackOk
    ? (mismatch ? '，回读不一致：' + JSON.stringify(raw) : '，回读一致')
    : ('，回读失败 ' + (readbackRan.error || '')))
  return done(readbackOk && !mismatch, summary, {
    values: vals,
    readback: readbackOk ? raw : [],
    frames: framesOf(ran) || framesOf(readbackRan),
  })
}


const deviceAlarms = (device, values) => {
  const byId = {}
  for (const seg of normalizeSegments(device.segments)) byId[seg.id] = seg
  const active = device.alarmActive && typeof device.alarmActive === 'object' ? device.alarmActive : {}
  const next = { ...active }
  const fired = []
  const cleared = []
  for (const rec of Array.isArray(values) ? values : []) {
    if (!rec || !rec.key || rec.ok !== true) continue
    const seg = byId[rec.segmentId]
    if (!seg || (seg.alarmMin === null && seg.alarmMax === null)) continue
    const breach = evaluateAlarm(seg, rec.value)
    if (breach && !next[rec.key]) {
      next[rec.key] = true
      fired.push({ seg, address: rec.address, value: rec.value, kind: breach })
    } else if (!breach && next[rec.key]) {
      delete next[rec.key]
      cleared.push({ seg, address: rec.address, value: rec.value })
    }
  }
  return { next, fired, cleared }
}

const alarmLabel = (item, kind) => {
  const name = item.seg.name || functionTag(item.seg.function) + item.address
  const limit = kind === 'max' ? item.seg.alarmMax : item.seg.alarmMin
  const shown = decodeValue(item.seg, item.value)
  return name + '=' + shown + (kind === 'max' ? '>' + limit : '<' + limit)
}


export const modbusPoll = async (home, cwd, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const devices = pack.devices.length ? pack.devices : [activeDevice(pack)]
  const hasWork = devices.some((item) => item.segments && item.segments.length)
  if (!hasWork) return { ok: false, error: '无寄存器段', polling: pack.polling, values: pack.values, devices }
  if (hasRunning(workspace, 'read')) {
    return { ok: true, skipped: true, polling: pack.polling, values: pack.values, devices }
  }
  if (pollLocks.has(room.cwd)) {
    return { ok: true, skipped: true, busy: true, polling: pack.polling, values: pack.values, devices }
  }
  const outer = signalOf(null, opts)
  const budgetMs = Number(opts && opts.budgetMs)
  const budget = AbortSignal.timeout(Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : POLL_BUDGET_MS)
  const signal = outer ? AbortSignal.any([outer, budget]) : budget
  const lives = new Map()
  const alarmActive = new Map()
  const firedAll = []
  const clearedAll = []
  pollLocks.set(room.cwd, lives)
  let ok = true
  let timedOut = false
  try {
    const python = loadBindings(home).python
    for (const device of devices) {
      if (aborted(signal)) {
        timedOut = true
        ok = false
        break
      }
      if (!device.segments.length) continue
      if (device.role === 'slave') {
        if (device.sim && device.listen) {
          const ran = readSegmentsSim(device, device.segments)
          lives.set(device.id, {
            values: ran.values,
            polling: { lastAt: Date.now(), lastOk: true, error: '' },
          })
        }
        continue
      }
      if (!device.polling.enabled) continue
      if (!device.sim && !python) {
        ok = false
        lives.set(device.id, {
          values: device.values,
          polling: { lastAt: Date.now(), lastOk: false, error: '请先在设置 → 台架 绑定 Python' },
        })
        continue
      }
      const ran = await readSegments(device.sim ? '' : python, device, device.segments, room.cwd, 4000, signal)
      if (ran.cancelled || aborted(signal)) {
        timedOut = true
        ok = false
        lives.set(device.id, {
          values: device.values,
          polling: { lastAt: Date.now(), lastOk: false, error: '轮询超时' },
        })
        break
      }
      if (!ran.ok) ok = false
      const alarms = deviceAlarms(device, ran.values)
      alarmActive.set(device.id, alarms.next)
      firedAll.push(...alarms.fired)
      clearedAll.push(...alarms.cleared)
      lives.set(device.id, {
        values: ran.values,
        polling: {
          lastAt: Date.now(),
          lastOk: ran.ok,
          error: ran.ok ? '' : (ran.error || ''),
        },
      })
    }
    if (timedOut) {
      for (const device of devices) {
        if (!device.polling || !device.polling.enabled || lives.has(device.id)) continue
        lives.set(device.id, {
          values: device.values,
          polling: { lastAt: Date.now(), lastOk: false, error: '轮询超时' },
        })
      }
    }
    const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    const merged = latest.devices.map((item) => {
      const live = lives.get(item.id)
      if (!live) return item
      return {
        ...item,
        values: live.values,
        polling: { ...item.polling, ...live.polling },
        alarmActive: alarmActive.get(item.id) || item.alarmActive || {},
      }
    })
    if (firedAll.length) {
      recordBenchEvent(home, room.cwd, {
        action: 'alarm',
        ok: false,
        summary: '越限告警：' + firedAll.slice(0, 5).map((item) => alarmLabel(item, item.kind)).join('；'),
      }, { source: 'system' })
      void notifyBenchEvent(home, room.cwd,
        '台架告警：' + firedAll.slice(0, 3).map((item) => alarmLabel(item, item.kind)).join('；')).catch(() => {})
    }
    if (clearedAll.length) {
      recordBenchEvent(home, room.cwd, {
        action: 'alarm-clear',
        ok: true,
        summary: '告警恢复：' + clearedAll.slice(0, 5).map((item) => alarmLabel(item, '')).join('；'),
      }, { source: 'system' })
    }
    const saved = saveWorkspace(home, room.cwd, { modbus: { devices: merged, activeId: latest.activeId } })
    return {
      ok,
      skipped: false,
      partial: timedOut,
      timedOut,
      values: saved.workspace.modbus.values,
      polling: saved.workspace.modbus.polling,
      devices: saved.workspace.modbus.devices,
      error: ok ? undefined : (timedOut ? '轮询超时' : merged.map((item) => item.polling.error).filter(Boolean)[0]),
    }
  } finally {
    pollLocks.delete(room.cwd)
  }
}


export const _internal = { deviceAlarms, alarmLabel }
