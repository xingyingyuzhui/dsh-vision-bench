import { runExecFile } from './bench-run.mjs'
import { listSerialPorts } from './bench-serial.mjs'
import { loadBindings, loadWorkspace, probeBindings } from './bench-store.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'

const firstLine = (text) => String(text || '').split('\n').filter(Boolean)[0] || ''

export const runSelfCheck = async (home, cwd) => {
  const checks = []
  const push = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 120) })
  }

  const bindings = loadBindings(home)
  const health = probeBindings(bindings)
  for (const key of ['python', 'uv4', 'openocd']) {
    push('bind-' + key, health[key].bound && health[key].exists,
      bindings[key] || '未绑定')
  }

  if (health.python.bound && health.python.exists) {
    const ver = await runExecFile(bindings.python, ['--version'], { timeoutMs: 10000 })
    push('python-runs', ver.exitCode === 0, firstLine(ver.stdout || ver.stderr))
    const modbus = await runExecFile(bindings.python,
      ['-c', 'import pymodbus, sys; v = getattr(pymodbus, "__version__", "?"); print(v)'],
      { timeoutMs: 20000 })
    push('pymodbus', modbus.exitCode === 0, firstLine(modbus.stdout || modbus.stderr))
    const serial = await runExecFile(bindings.python,
      ['-c', 'import serial; print(getattr(serial, "__version__", "?"))'],
      { timeoutMs: 20000 })
    push('pyserial', serial.exitCode === 0, firstLine(serial.stdout || serial.stderr))
  }

  if (health.uv4.bound && health.uv4.exists) {
    push('uv4-file', true, bindings.uv4)
  }
  if (health.openocd.bound && health.openocd.exists) {
    const oc = await runExecFile(bindings.openocd, ['--version'], { timeoutMs: 10000 })
    const out = oc.stderr || oc.stdout
    push('openocd-runs', oc.exitCode === 0 || /open (on-chip )?debugger/i.test(out), firstLine(out))
  }

  if (cwd) {
    const room = requireWorkspaceCwd(cwd)
    if (room.error) {
      push('workspace', false, room.error)
    } else {
      const ws = loadWorkspace(home, room.cwd)
      push('workspace', true, room.cwd + ' · 工程 ' + (ws.keil.project ? '已选' : '未选'))
    }
  } else {
    push('workspace', false, '无工作区会话')
  }

  try {
    const ports = await listSerialPorts()
    const count = Array.isArray(ports && ports.ports) ? ports.ports.length : 0
    push('serial-scan', true, count + ' 个串口')
  } catch (error) {
    push('serial-scan', false, String((error && error.message) || error))
  }

  return {
    ok: checks.every((item) => item.ok),
    checks,
    at: Date.now(),
  }
}
