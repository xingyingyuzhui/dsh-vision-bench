import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { _internal as runInternal } from './bench-run.mjs'

const MONITOR_SCRIPT = join(runInternal.RUNTIME_DIR, 'serial_monitor.py')
const MAX_LINES = 2000

const monitors = new Map()

export const openSerialMonitor = (pythonBin, cwd, opts) => {
  if (!pythonBin) return { ok: false, error: '请先在设置 → 台架 绑定 Python' }
  const port = String((opts && opts.port) || '').trim()
  const baudrate = Number(opts && opts.baudrate) > 0 ? Number(opts.baudrate) : 115200
  if (!port) return { ok: false, error: '缺少串口' }
  closeSerialMonitor(cwd)
  let child
  try {
    child = spawn(pythonBin, [MONITOR_SCRIPT, '--port', port, '--baudrate', String(baudrate)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    return { ok: false, error: '无法启动监视进程: ' + String((error && error.message) || error).slice(0, 160) }
  }
  const state = {
    child,
    buffer: [],
    nextId: 1,
    closed: false,
    error: '',
    port,
    baudrate,
  }
  monitors.set(cwd, state)
  child.stdout.setEncoding('utf8')
  let pending = ''
  child.stdout.on('data', (chunk) => {
    pending += chunk
    let idx
    while ((idx = pending.indexOf('\n')) >= 0) {
      const raw = pending.slice(0, idx).trim()
      pending = pending.slice(idx + 1)
      if (!raw) continue
      try {
        const obj = JSON.parse(raw)
        if (obj && obj.error) {
          state.error = String(obj.error.message || '串口错误').slice(0, 180)
          continue
        }
        state.buffer.push({
          id: state.nextId++,
          t: Number(obj.t) || Date.now(),
          line: String(obj.line || '').slice(0, 500),
        })
        if (state.buffer.length > MAX_LINES) {
          state.buffer.splice(0, state.buffer.length - MAX_LINES)
        }
      } catch { /* skip malformed line */ }
    }
  })
  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim()
    if (text && !state.error) state.error = text.slice(0, 180)
  })
  child.on('exit', (code) => {
    state.closed = true
    if (!state.error && code) state.error = '监视进程退出（' + code + '）'
  })
  child.on('error', (error) => {
    state.closed = true
    state.error = String((error && error.message) || error).slice(0, 180)
  })
  return { ok: true, port, baudrate }
}

export const serialState = (cwd) => {
  const m = monitors.get(cwd)
  if (!m) return { open: false, port: '', baudrate: 0, error: '', total: 0 }
  return {
    open: !m.closed,
    port: m.port,
    baudrate: m.baudrate,
    error: m.error,
    total: m.nextId - 1,
  }
}

export const serialFeed = (cwd, since) => {
  const m = monitors.get(cwd)
  if (!m) return { ok: true, open: false, lines: [], lastId: 0, error: '' }
  const after = Number(since) > 0 ? Number(since) : 0
  const lines = m.buffer.filter((item) => item.id > after).slice(-500)
  return {
    ok: true,
    open: !m.closed,
    error: m.error,
    lines,
    lastId: m.nextId - 1,
  }
}

export const closeSerialMonitor = (cwd) => {
  const m = monitors.get(cwd)
  if (!m) return { ok: true }
  try { m.child.kill() } catch { /* already gone */ }
  monitors.delete(cwd)
  return { ok: true }
}

export const stopAllSerialMonitors = () => {
  for (const m of monitors.values()) {
    try { m.child.kill() } catch { /* ignore */ }
  }
  monitors.clear()
}
