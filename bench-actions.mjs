import { join, basename } from 'node:path'
import { listWorkspaceDir, pickArtifact, artifactInfo } from './bench-fs.mjs'
import { requireKeilProject, requireWorkspaceCwd } from './bench-paths.mjs'
import {
  finishTask,
  loadBindings,
  loadWorkspace,
  openTask,
  pruneBuildLogs,
  recordBenchEvent,
  saveWorkspace,
  storeDir,
} from './bench-store.mjs'
import {
  applyPointWrite,
  applySegmentRead,
  clampInt,
  decodeValue,
  evaluateAlarm,
  functionTag,
  normalizeSegments,
  normalizeWriteValues,
  segmentCovering,
  simulateSegmentRan,
} from './bench-points.mjs'
import { activeDevice, normalizeModbus } from './bench-devices.mjs'
import { runPythonScript } from './bench-run.mjs'
import { serialDevicePath } from './bench-serial.mjs'
import { notifyBenchEvent } from './bench-notify.mjs'

const needPython = (bindings) => {
  if (!bindings.python) return '请先在设置 → 台架 绑定 Python'
  return null
}

const needUv4 = (bindings) => {
  if (!bindings.uv4) return '请先在设置 → 台架 绑定 Keil UV4'
  return null
}

export const withCwd = (cwd, home) => requireWorkspaceCwd(cwd, home)

const originOf = (body) => ({
  source: body && body.source === 'agent' ? 'agent' : 'user',
  sessionId: body && body.sessionId ? String(body.sessionId) : '',
})

const hasRunning = (workspace, type) =>
  (workspace.tasks || []).some((item) => item.type === type && item.status === 'running')

const MODBUS_PATCH_KEYS = ['mode', 'port', 'host', 'tcpPort', 'slave', 'baudrate', 'function', 'address', 'count', 'sim', 'timeoutSec']

export const pickModbusPatch = (raw) => {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of MODBUS_PATCH_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}

const pollLocks = new Map()
const POLL_BUDGET_MS = 30000

const signalOf = (body, opts) => (opts && opts.signal) || (body && body.signal) || undefined

const aborted = (signal) => !!(signal && signal.aborted)

export const keilScan = async (home, cwd, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings)
  if (missing) return { ok: false, error: missing }
  return runPythonScript(bindings.python, 'keil_project.py', ['scan', '--root', room.cwd, '--json'], {
    cwd: room.cwd,
    timeoutMs: 30000,
    signal: signalOf(null, opts),
  })
}

export const keilTargets = async (home, cwd, project, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings)
  if (missing) return { ok: false, error: missing }
  const keil = requireKeilProject(room.cwd, project)
  if (keil.error) return { ok: false, error: keil.error }
  return runPythonScript(bindings.python, 'keil_project.py', ['targets', '--project', keil.project, '--json'], {
    cwd: room.cwd,
    timeoutMs: 15000,
    signal: signalOf(null, opts),
  })
}

export const keilMap = async (home, cwd, project, target, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings)
  if (missing) return { ok: false, error: missing }
  const workspace = loadWorkspace(home, room.cwd)
  const picked = project || (workspace.keil && workspace.keil.project)
  const keil = requireKeilProject(room.cwd, picked)
  if (keil.error) return { ok: false, error: keil.error }
  const name = (target || (workspace.keil && workspace.keil.target) || '').trim()
  return runPythonScript(bindings.python, 'keil_project.py', [
    'map', '--project', keil.project, '--target', name, '--root', room.cwd, '--json',
  ], {
    cwd: room.cwd,
    timeoutMs: 20000,
    signal: signalOf(null, opts),
  })
}

export const keilBuild = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings) || needUv4(bindings)
  if (missing) return { ok: false, error: missing }
  const workspace = loadWorkspace(home, room.cwd)
  const project = (body && body.project) || workspace.keil.project
  const target = (body && body.target) || workspace.keil.target
  const artifact = (body && body.artifact) || workspace.keil.artifact
  const keil = requireKeilProject(room.cwd, project)
  if (keil.error) return { ok: false, error: keil.error === '工程必须是绝对路径' ? '请先在工作区里选择 Keil 工程' : keil.error }
  if (hasRunning(workspace, 'build')) {
    return { ok: false, error: '已有编译任务进行中' }
  }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const origin = originOf(body)
  const task = openTask(home, room.cwd, {
    type: 'build',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: '编译 ' + (target || keil.project),
  })
  const ran = await runPythonScript(bindings.python, 'keil_build.py', [
    '--uv4', bindings.uv4,
    '--project', keil.project,
    '--target', target || '',
    '--log-dir', join(storeDir(home), 'logs'),
    '--task-id', task.id,
    '--json',
  ], { cwd: room.cwd, timeoutMs: 620000, signal })
  if (ran.cancelled) {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '编译已取消', keil: { project: keil.project, target, artifact } })
    return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source }
  }
  const details = ran.result && ran.result.details ? ran.result.details : {}
  const download = pickArtifact(details, artifact)
  const ok = ran.ok && (!ran.result || ran.result.status !== 'error')
  const summary = ((ran.result && ran.result.summary) || (ok ? '编译成功' : ('编译失败 ' + (ran.error || ''))))
    + (download.path ? ' → ' + download.path : '')
  finishTask(home, room.cwd, task.id, {
    ok,
    summary,
    logFile: details.log_file || '',
    phase: details.phase || '',
    errors: Array.isArray(details.errors) ? details.errors : [],
    keil: { project: keil.project, target, artifact, download: download.path || '' },
  })
  try {
    pruneBuildLogs(home)
  } catch { /* retention is best-effort */ }
  if (!ok) {
    return {
      ...ran,
      ok: false,
      taskId: task.id,
      source: origin.source,
      result: ran.result ? { ...ran.result, download } : { summary, details, download },
    }
  }
  return {
    ...ran,
    taskId: task.id,
    source: origin.source,
    result: {
      ...ran.result,
      download,
    },
  }
}

export const listDir = (cwd, path) => listWorkspaceDir(cwd, path)

export const FLASH_INTERFACES = ['cmsis-dap', 'stlink', 'jlink', 'ftdi', 'dap']
export const FLASH_TARGETS = [
  'stm32f1x', 'stm32f2x', 'stm32f4x', 'stm32f7x', 'stm32g0x', 'stm32g4x',
  'stm32h7x', 'stm32l0x', 'stm32l4x', 'nrf51', 'nrf52', 'rp2040', 'lpc55',
  'kinetis', 'efm32', 'at91samd',
]

export const openocdDownload = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const bindings = loadBindings(home)
  if (!bindings.openocd) return { ok: false, error: '请先在设置 → 台架 绑定 OpenOCD' }
  if (!bindings.python) return { ok: false, error: '请先在设置 → 台架 绑定 Python' }
  const workspace = loadWorkspace(home, room.cwd)
  const keil = workspace.keil
  const file = (body && body.path) || keil.download
  if (!file) return { ok: false, error: '没有可下载的固件产物，请先编译' }
  const info = artifactInfo(room.cwd, file)
  if (!info.ok) return { ok: false, error: info.error }
  const iface = FLASH_INTERFACES.indexOf(body && body.interface) >= 0
    ? body.interface
    : ((keil.flash && keil.flash.interface) || 'cmsis-dap')
  const target = FLASH_TARGETS.indexOf(body && body.target) >= 0
    ? body.target
    : ((keil.flash && keil.flash.target) || 'stm32f1x')
  if (hasRunning(workspace, 'download')) {
    return { ok: false, error: '已有下载任务进行中' }
  }
  if (!(body && body.confirm === true)) {
    return {
      ok: false,
      needsConfirm: true,
      request: {
        kind: 'download',
        interface: iface,
        target,
        file: info.path,
        name: info.name,
        size: info.size,
        sha256: info.sha256,
      },
      error: '烧录会改写设备 Flash，需要用户确认',
    }
  }
  saveWorkspace(home, room.cwd, { keil: { flash: { interface: iface, target } } })
  const origin = originOf(body)
  const task = openTask(home, room.cwd, {
    type: 'download',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: '烧录 ' + target + ' ← ' + (info.name || basename(info.path)),
  })
  const ran = await runPythonScript(bindings.python, 'openocd_flash.py', [
    '--openocd', bindings.openocd,
    '--interface', iface,
    '--target', target,
    '--file', info.path,
    '--json',
  ], { cwd: room.cwd, timeoutMs: 150000, signal })
  if (ran.cancelled) {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '烧录已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  const details = ran.result && ran.result.details ? ran.result.details : {}
  const ok = ran.ok && ran.result && ran.result.status !== 'error'
  const summary = (ran.result && ran.result.summary) || ('烧录失败 ' + (ran.error || ''))
  finishTask(home, room.cwd, task.id, {
    ok,
    summary,
    phase: 'flash',
    errors: ok ? [] : [String((details.output || ran.error || '').split('\n').pop() || '').slice(0, 240)],
    keil: { download: info.path },
  })
  return { ...ran, ok, taskId: task.id, source: origin.source, summary }
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

const runSegment = (python, conn, segment, cwd, timeoutMs, signal) => runPythonScript(python, 'modbus_read.py', conn.concat([
  '--function', String(segment.function),
  '--address', String(segment.address),
  '--count', String(segment.count),
]), { cwd, timeoutMs: timeoutMs || 20000, signal })

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
  const results = []
  for (const segment of list) {
    if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消', values, okCount, results }
    const ran = await runSegment(python, conn.args, segment, cwd, timeoutMs, signal)
    if (ran.cancelled) return { ok: false, cancelled: true, error: '已取消', values, okCount, results }
    values = applySegmentRead(values, segment, ran)
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
    finishTask(home, room.cwd, task.id, { ok: ran.ok, summary, modbus: { devices, activeId: latest.activeId } })
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
  ])
  const task = openTask(home, room.cwd, {
    type: 'read',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: 'Modbus 读 f' + m.function + '@' + m.address,
  })
  const ran = await runPythonScript(bindings.python, 'modbus_read.py', args, {
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
  finishTask(home, room.cwd, task.id, { ok: !!ran.ok, summary })
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

export const modbusWrite = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const workspace = loadWorkspace(home, room.cwd)
  const pack = normalizeModbus(workspace.modbus)
  const device = (body && body.deviceId)
    ? (pack.devices.find((item) => item.id === body.deviceId) || activeDevice(pack))
    : activeDevice(pack)
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
  const bindings = m.sim ? { python: '' } : loadBindings(home)
  let conn = null
  if (!m.sim) {
    conn = connectionArgs(m)
    if (conn.error) return { ok: false, error: conn.error }
  }
  const origin = originOf(body)
  const tag = functionTag(fn)
  const label = count === 1
    ? ('写 ' + tag + address + ' = ' + check.values[0])
    : ('批量写 ' + tag + address + '–' + (address + count - 1) + '（' + count + ' 点）')
  const before = []
  for (let i = 0; i < count; i++) before.push(pointBefore(m, fn, address + i))
  const task = openTask(home, room.cwd, {
    type: 'write',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: label,
  })
  const done = (ok, summary, extra = {}) => {
    const latest = normalizeModbus(loadWorkspace(home, room.cwd).modbus)
    const devices = extra.devices || latest.devices.map((item) => item.id === m.id ? { ...item, ...extra.devicePatch } : item)
    finishTask(home, room.cwd, task.id, {
      ok,
      summary,
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
    const devices = pack.devices.map((item) => item.id === m.id
      ? { ...item, values: vals, sim: false }
      : item)
    return done(true, label + '（本地生效）', { devices, simulated: m.sim === true, readback: check.values.slice() })
  }

  const ran = await runPythonScript(bindings.python, 'modbus_write.py', conn.args.concat([
    '--function', String(check.fc),
    '--address', String(address),
    '--values', check.values.join(','),
  ]), { cwd: room.cwd, timeoutMs: 20000, signal })
  if (ran.cancelled) {
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '写入已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  if (!ran.ok) {
    return done(false, '写入失败 ' + (ran.error || ''))
  }
  const readbackRan = await runSegment(bindings.python, conn, { id: 'write-back', function: fn, address, count }, room.cwd, 20000, signal)
  const raw = readbackRan.ok && readbackRan.result && readbackRan.result.details && Array.isArray(readbackRan.result.details.raw)
    ? readbackRan.result.details.raw.slice(0, count)
    : []
  const readbackOk = readbackRan.ok && raw.length === count
  let vals = Array.isArray(m.values) ? m.values : []
  for (let i = 0; i < count; i++) {
    const seg = segmentCovering(m.segments, fn, address + i) || { id: 'write', function: fn, address: address + i, count: 1 }
    vals = applyPointWrite(vals, seg, address + i, raw[i] !== undefined ? raw[i] : null, Date.now())
  }
  const devices = pack.devices.map((item) => item.id === m.id ? { ...item, values: vals } : item)
  const mismatch = readbackOk && raw.some((value, i) => Number(value) !== Number(check.values[i]))
  const summary = label + (readbackOk
    ? (mismatch ? '，回读不一致：' + JSON.stringify(raw) : '，回读一致')
    : ('，回读失败 ' + (readbackRan.error || '')))
  return done(readbackOk && !mismatch, summary, { devices, readback: readbackOk ? raw : [] })
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
