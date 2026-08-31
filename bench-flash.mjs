import { basename } from 'node:path'
import { artifactInfo } from './bench-fs.mjs'
import { aborted, hasRunning, originOf, signalOf } from './bench-journal.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { finishTask, loadBindings, loadWorkspace, openTask, saveWorkspaceAsync } from './bench-store.mjs'

import {
  DEFAULT_OPENOCD_INTERFACE,
  DEFAULT_OPENOCD_TARGET,
  FLASH_INTERFACES,
  FLASH_TARGETS,
  resolveOpenOcdProfile,
} from './src/domain/flash/openocd-profile.mjs'
import { runOpenOcdFlash } from './src/infrastructure/process/openocd-runner.mjs'

export { DEFAULT_OPENOCD_INTERFACE, DEFAULT_OPENOCD_TARGET, FLASH_INTERFACES, FLASH_TARGETS }

export const openocdDownload = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const bindings = loadBindings(home)
  if (!bindings.openocd) return { ok: false, error: '请先在设置 → Vision 绑定 OpenOCD' }
  const workspace = loadWorkspace(home, room.cwd)
  const keil = workspace.keil
  const file = (body && body.path) || keil.download
  if (!file) return { ok: false, error: '没有可下载的固件产物，请先编译' }
  const info = artifactInfo(room.cwd, file)
  if (!info.ok) return { ok: false, error: info.error }
  const profile = resolveOpenOcdProfile(
    { interface: body && body.interface, target: body && body.target },
    keil.flash || {},
  )
  if (!profile.ok) return { ok: false, error: profile.error, errorCode: profile.errorCode }
  const iface = profile.interfaceName
  const target = profile.target
  if (hasRunning(workspace, 'download')) {
    return { ok: false, error: '已有下载任务进行中' }
  }
  // The user approved a specific artifact; re-verify it byte-for-byte before
  // flashing so a rebuild between confirm and approval cannot slip through.
  if (body && body.confirm === true) {
    const expectedSha = typeof body.sha256 === 'string' ? body.sha256 : ''
    const expectedSize = Number(body.size)
    if (expectedSize > 0 && info.size !== expectedSize) {
      return { ok: false, error: '固件已变化（大小不匹配），请重新确认后烧录' }
    }
    if (expectedSha && info.sha256 && info.sha256 !== expectedSha) {
      return { ok: false, error: '固件已变化（sha256 不匹配），请重新确认后烧录' }
    }
  } else {
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
  await saveWorkspaceAsync(home, room.cwd, { keil: { flash: { interface: iface, target } } })
  const origin = originOf(body)
  const task = await openTask(home, room.cwd, {
    type: 'download',
    source: origin.source,
    sessionId: origin.sessionId,
    summary: '烧录 ' + target + ' ← ' + (info.name || basename(info.path)),
  })
  const ran = await (opts && opts.runOpenOcdFlash ? opts.runOpenOcdFlash : runOpenOcdFlash)(
    {
      openocd: bindings.openocd,
      interfaceName: iface,
      target,
      firmware: info.path,
      cwd: room.cwd,
      timeoutMs: 150000,
      signal,
    },
    { runExecFile: opts && opts.runExecFile },
  )
  if (ran.cancelled) {
    await finishTask(home, room.cwd, task.id, { cancelled: true, summary: '烧录已取消' })
    return { ok: false, cancelled: true, taskId: task.id, source: origin.source, error: '已取消' }
  }
  const details = ran.details && typeof ran.details === 'object' ? ran.details : {}
  const ok = ran.ok === true
  const summary = ran.summary || '烧录失败 ' + (ran.error || '')
  await finishTask(home, room.cwd, task.id, {
    ok,
    summary,
    phase: 'flash',
    errors: ok ? [] : [String((details.output || ran.error || '').split('\n').pop() || '').slice(0, 240)],
    keil: { download: info.path },
  })
  return { ...ran, ok, taskId: task.id, source: origin.source, summary }
}
