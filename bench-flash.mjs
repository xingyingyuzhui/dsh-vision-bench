import { basename } from 'node:path'
import { artifactInfo } from './bench-fs.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { finishTask, loadBindings, loadWorkspace, openTask, saveWorkspace } from './bench-store.mjs'
import { aborted, hasRunning, originOf, signalOf } from './bench-journal.mjs'

import { runPythonScript } from './bench-run.mjs'

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
