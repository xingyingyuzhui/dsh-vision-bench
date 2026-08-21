import { join } from 'node:path'
import { listWorkspaceDir, pickArtifact } from './bench-fs.mjs'
import { pathInside, requireWorkspaceCwd } from './bench-paths.mjs'
import {
  finishTask,
  loadBindings,
  loadWorkspace,
  openTask,
  saveWorkspace,
  storeDir,
} from './bench-store.mjs'
import { applySegmentRead, normalizeSegments, simulateSegmentRan } from './bench-points.mjs'
import { activeDevice, normalizeModbus } from './bench-devices.mjs'
import { runPythonScript } from './bench-run.mjs'
import { serialDevicePath } from './bench-serial.mjs'

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

export const keilScan = async (home, cwd) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings)
  if (missing) return { ok: false, error: missing }
  return runPythonScript(bindings.python, 'keil_project.py', ['scan', '--root', room.cwd, '--json'], {
    cwd: room.cwd,
    timeoutMs: 30000,
  })
}

export const keilTargets = async (home, cwd, project) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings)
  if (missing) return { ok: false, error: missing }
  if (!project || !pathInside(room.cwd, project)) {
    return { ok: false, error: '工程必须在当前工作区内' }
  }
  return runPythonScript(bindings.python, 'keil_project.py', ['targets', '--project', project, '--json'], {
    cwd: room.cwd,
    timeoutMs: 15000,
  })
}

export const keilBuild = async (home, cwd, body) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const bindings = loadBindings(home)
  const missing = needPython(bindings) || needUv4(bindings)
  if (missing) return { ok: false, error: missing }
  const workspace = loadWorkspace(home, room.cwd)
  const project = (body && body.project) || workspace.keil.project
  const target = (body && body.target) || workspace.keil.target
  const artifact = (body && body.artifact) || workspace.keil.artifact
  if (!project || !pathInside(room.cwd, project)) {
    return { ok: false, error: '请先在工作区里选择 Keil 工程' }
  }
  if (hasRunning(workspace, 'build')) {
    return { ok: false, error: '已有编译任务进行中' }
  }
  const origin = originOf(body)
  const task = openTask(home, room.cwd, {
    type: 'build',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: '编译 ' + (target || project),
  })
  const ran = await runPythonScript(bindings.python, 'keil_build.py', [
    '--uv4', bindings.uv4,
    '--project', project,
    '--target', target || '',
    '--log-dir', join(storeDir(home), 'logs'),
    '--json',
  ], { cwd: room.cwd, timeoutMs: 620000 })
  if (!ran.ok) {
    const summary = '编译失败 ' + (ran.error || '')
    finishTask(home, room.cwd, task.id, { ok: false, summary, keil: { project, target, artifact } })
    return { ...ran, taskId: task.id, source: origin.source }
  }
  const details = ran.result && ran.result.details ? ran.result.details : {}
  const download = pickArtifact(details, artifact)
  const ok = !ran.result || ran.result.status !== 'error'
  const summary = ((ran.result && ran.result.summary) || (ok ? '编译成功' : '编译失败'))
    + (download.path ? ' → ' + download.path : '')
  finishTask(home, room.cwd, task.id, {
    ok,
    summary,
    keil: { project, target, artifact, download: download.path || '' },
  })
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

const runSegment = (python, conn, segment, cwd, timeoutMs) => runPythonScript(python, 'modbus_read.py', conn.concat([
  '--function', String(segment.function),
  '--address', String(segment.address),
  '--count', String(segment.count),
]), { cwd, timeoutMs: timeoutMs || 20000 })

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

const readSegments = async (python, m, list, cwd, timeoutMs) => {
  if (m.role === 'slave') return m.sim ? readSegmentsSim(m, list) : { ok: true, values: m.values || [], okCount: list.length, results: [], error: '' }
  if (m.sim) return readSegmentsSim(m, list)
  const conn = connectionArgs(m)
  if (conn.error) return { ok: false, error: conn.error, values: m.values || [], okCount: 0 }
  let values = m.values || []
  let okCount = 0
  let lastError = ''
  const results = []
  for (const segment of list) {
    const ran = await runSegment(python, conn.args, segment, cwd, timeoutMs)
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

export const modbusRead = async (home, cwd, body) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const saved = saveWorkspace(home, room.cwd, {
    keil: workspace.keil,
    modbus: { ...workspace.modbus, ...(body && body.modbus) },
  })
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
    const ran = await readSegments(bindings.python, m, list, room.cwd, 20000)
    const summary = (sim ? '仿真 ' : '') + (ran.ok
      ? ('读取 ' + list.length + ' 段成功')
      : ('读取 ' + ran.okCount + '/' + list.length + ' 段成功' + (ran.error ? '：' + ran.error : '')))
    const devices = pack.devices.map((item) => item.id === m.id ? { ...item, values: ran.values } : item)
    finishTask(home, room.cwd, task.id, { ok: ran.ok, summary, modbus: { devices, activeId: pack.activeId, values: ran.values } })
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
  })
  const value = ran.result && ran.result.details && ran.result.details.value
  const summary = ran.ok
    ? ('Modbus 读 f' + m.function + '@' + m.address + ' = ' + JSON.stringify(value))
    : ('Modbus 读失败 ' + (ran.error || ''))
  finishTask(home, room.cwd, task.id, { ok: !!ran.ok, summary })
  return { ...ran, taskId: task.id, source: origin.source }
}

export const modbusPoll = async (home, cwd) => {
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
  const python = loadBindings(home).python
  const next = []
  let ok = true
  for (const device of devices) {
    if (!device.segments.length) {
      next.push(device)
      continue
    }
    if (device.role === 'slave') {
      if (device.sim) {
        const ran = readSegmentsSim(device, device.segments)
        next.push({
          ...device,
          values: ran.values,
          polling: { ...device.polling, lastAt: Date.now(), lastOk: true, error: '' },
        })
      } else next.push(device)
      continue
    }
    const watch = device.sim || device.polling.enabled || pack.polling.enabled
    if (!watch) {
      next.push(device)
      continue
    }
    if (!device.sim && !python) {
      ok = false
      next.push({
        ...device,
        polling: { ...device.polling, lastAt: Date.now(), lastOk: false, error: '请先在设置 → 台架 绑定 Python' },
      })
      continue
    }
    const ran = await readSegments(device.sim ? '' : python, device, device.segments, room.cwd, 4000)
    if (!ran.ok) ok = false
    next.push({
      ...device,
      values: ran.values,
      polling: {
        ...device.polling,
        lastAt: Date.now(),
        lastOk: ran.ok,
        error: ran.ok ? '' : (ran.error || ''),
      },
    })
  }
  const saved = saveWorkspace(home, room.cwd, { modbus: { devices: next, activeId: pack.activeId } })
  return {
    ok,
    skipped: false,
    values: saved.workspace.modbus.values,
    polling: saved.workspace.modbus.polling,
    devices: saved.workspace.modbus.devices,
    error: ok ? undefined : next.map((item) => item.polling.error).filter(Boolean)[0],
  }
}
