import { basename, join } from 'node:path'
import { artifactInfo } from './bench-fs.mjs'
import { aborted, originOf, signalOf } from './bench-journal.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import {
  finishTask,
  loadBindings,
  loadWorkspace,
  openExclusiveTask,
  saveWorkspaceAsync,
  storeDir,
} from './bench-store.mjs'
import { defaultFlashApprovals } from './src/application/flash/flash-approval-service.mjs'
import { FLASH_ERROR_CODES } from './src/domain/flash/errors.mjs'
import {
  DEFAULT_OPENOCD_INTERFACE,
  DEFAULT_OPENOCD_TARGET,
  FLASH_INTERFACES,
  FLASH_TARGETS,
  resolveOpenOcdProfile,
} from './src/domain/flash/openocd-profile.mjs'
import { createFirmwareSnapshot, removeFirmwareSnapshot } from './src/infrastructure/files/firmware-snapshot.mjs'
import { runOpenOcdFlash } from './src/infrastructure/process/openocd-runner.mjs'

export { DEFAULT_OPENOCD_INTERFACE, DEFAULT_OPENOCD_TARGET, FLASH_INTERFACES, FLASH_TARGETS }

const flashFail = (errorCode, error, extra = {}) => ({ ok: false, errorCode, error, ...extra })

const toPublicRequest = (record) => ({
  kind: 'download',
  requestId: record.requestId,
  interface: record.interfaceName,
  target: record.target,
  file: record.path,
  name: record.name,
  size: record.size,
  sha256: record.sha256,
  expiresAt: record.expiresAt,
})

export const openocdDownload = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const approvals = (opts && opts.approvals) || defaultFlashApprovals
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const bindings = loadBindings(home)
  if (!bindings.openocd) return { ok: false, error: '请先在设置 → Vision 绑定 OpenOCD' }

  if (body && body.confirm === true) {
    return flashFail(FLASH_ERROR_CODES.FLASH_APPROVAL_REQUIRED, '烧录必须通过批准请求', {
      error: '烧录必须通过批准请求',
    })
  }

  if (body && body.approved === false) {
    const consumed = approvals.consume(body.requestId, { cwd: room.cwd })
    if (!consumed.ok) return consumed
    return { ok: false, cancelled: true, error: '已取消', requestId: consumed.record.requestId }
  }

  if (body && body.approved === true) {
    const consumed = approvals.consume(body.requestId, { cwd: room.cwd })
    if (!consumed.ok) return consumed
    return executeApprovedFlash(home, room.cwd, consumed.record, body, opts, signal, bindings)
  }

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
  const origin = originOf(body)
  const record = approvals.create({
    cwd: room.cwd,
    sessionId: origin.sessionId,
    source: origin.source,
    path: info.path,
    name: info.name,
    size: info.size,
    sha256: info.sha256,
    interfaceName: profile.interfaceName,
    target: profile.target,
  })
  return {
    ok: false,
    needsConfirm: true,
    request: toPublicRequest(record),
    error: '烧录会改写设备 Flash，需要用户确认',
  }
}

async function executeApprovedFlash(home, cwd, record, body, opts, signal, bindings) {
  await saveWorkspaceAsync(home, cwd, { keil: { flash: { interface: record.interfaceName, target: record.target } } })
  const origin = originOf(body)
  const opened = await openExclusiveTask(
    home,
    cwd,
    {
      type: 'download',
      source: origin.source || record.source,
      sessionId: origin.sessionId || record.sessionId,
      summary: '烧录 ' + record.target + ' ← ' + (record.name || basename(record.path)),
    },
    { conflicts: ['build', 'download'] },
  )
  if (!opened.ok) return opened
  const task = opened.task
  const stagingRoot = join(storeDir(home), 'flash-staging')
  const snapshot = (opts && opts.createFirmwareSnapshot ? opts.createFirmwareSnapshot : createFirmwareSnapshot)({
    sourcePath: record.path,
    stagingRoot,
    taskId: task.id,
    expectedSha256: record.sha256,
    expectedSize: record.size,
  })
  if (!snapshot.ok) {
    await finishTask(home, cwd, task.id, {
      ok: false,
      summary: snapshot.error || '固件快照失败',
      errors: [snapshot.error || '固件快照失败'],
    })
    return { ...snapshot, ok: false, taskId: task.id, source: origin.source }
  }
  let result
  try {
    const ran = await (opts && opts.runOpenOcdFlash ? opts.runOpenOcdFlash : runOpenOcdFlash)(
      {
        openocd: bindings.openocd,
        interfaceName: record.interfaceName,
        target: record.target,
        firmware: snapshot.path,
        cwd,
        timeoutMs: 150000,
        signal,
      },
      { runExecFile: opts && opts.runExecFile },
    )
    if (ran.cancelled) {
      await finishTask(home, cwd, task.id, { cancelled: true, summary: '烧录已取消' })
      result = {
        ok: false,
        cancelled: true,
        taskId: task.id,
        source: origin.source,
        errorCode: ran.errorCode || FLASH_ERROR_CODES.FLASH_CANCELLED,
        error: '已取消',
      }
    } else {
      const details = ran.details && typeof ran.details === 'object' ? ran.details : {}
      const ok = ran.ok === true
      const summary = ran.summary || '烧录失败 ' + (ran.error || '')
      await finishTask(home, cwd, task.id, {
        ok,
        summary,
        phase: 'flash',
        errors: ok ? [] : [String((details.output || ran.error || '').split('\n').pop() || '').slice(0, 240)],
        keil: { download: record.path },
      })
      result = { ...ran, ok, taskId: task.id, source: origin.source, summary }
    }
  } finally {
    const cleaned = (opts && opts.removeFirmwareSnapshot ? opts.removeFirmwareSnapshot : removeFirmwareSnapshot)(
      snapshot.dir,
      stagingRoot,
    )
    if (result && cleaned && cleaned.ok === false) {
      result = {
        ...result,
        warnings: [...(result.warnings || []), { code: cleaned.errorCode, message: cleaned.error || '快照清理失败' }],
      }
    }
  }
  return result
}

export const _internal = { approvals: defaultFlashApprovals }
