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
import { clearFlashApprovals, defaultFlashApprovals } from './src/application/flash/flash-approval-service.mjs'
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
export { clearFlashApprovals }

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

function safeFlashError(error) {
  const raw = error instanceof Error ? error.message : String(error || '烧录失败')
  return raw.replace(/(?:[A-Za-z]:)?(?:\\|\/)[^\s:'"]+/g, '…').slice(0, 240) || '烧录失败'
}

function approvalScope(cwd, body) {
  const origin = originOf(body)
  return { cwd, sessionId: origin.sessionId }
}

function isOpenOcdRunnerResult(ran) {
  return !!(
    ran &&
    typeof ran === 'object' &&
    !Array.isArray(ran) &&
    (typeof ran.ok === 'boolean' ||
      ran.cancelled === true ||
      ran.timedOut === true ||
      ran.error ||
      ran.errorCode ||
      ran.summary)
  )
}

export const openocdDownload = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const approvals = (opts && opts.approvals) || defaultFlashApprovals
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const bindings = loadBindings(home)
  if (!bindings.openocd) return { ok: false, error: '请先在设置 → Vision 绑定 OpenOCD' }

  if (body && body.confirm === true) {
    return flashFail(FLASH_ERROR_CODES.FLASH_APPROVAL_REQUIRED, '烧录必须通过批准请求')
  }

  if (body && body.approved === false) {
    const consumed = approvals.consume(body.requestId, approvalScope(room.cwd, body))
    if (!consumed.ok) return consumed
    return { ok: false, cancelled: true, error: '已取消', requestId: consumed.record.requestId }
  }

  if (body && body.approved === true) {
    const consumed = approvals.consume(body.requestId, approvalScope(room.cwd, body))
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
  const approver = originOf(body)
  await saveWorkspaceAsync(home, cwd, { keil: { flash: { interface: record.interfaceName, target: record.target } } })
  const opened = await openExclusiveTask(
    home,
    cwd,
    {
      type: 'download',
      source: record.source,
      sessionId: record.sessionId,
      summary: '烧录 ' + record.target + ' ← ' + (record.name || basename(record.path)),
    },
    { conflicts: ['build', 'download'] },
  )
  if (!opened.ok) return opened
  const task = opened.task
  const stagingRoot = join(storeDir(home), 'flash-staging')
  let snapshot = { ok: false, dir: '', path: '' }
  let finished = false
  const finish = opts && typeof opts.finishTask === 'function' ? opts.finishTask : finishTask
  const completeTaskOnce = async (patch) => {
    if (finished) return
    finished = true
    await finish(home, cwd, task.id, patch)
  }
  const withAudit = (payload) => ({
    ...payload,
    taskId: task.id,
    source: record.source,
    sessionId: record.sessionId,
    approvedBySessionId: approver.sessionId,
  })
  const failFlash = async (error, extra = {}) => {
    const summary = safeFlashError(error)
    await completeTaskOnce({ ok: false, summary, errors: [summary] })
    return withAudit({
      ok: false,
      errorCode: FLASH_ERROR_CODES.FLASH_FAILED,
      error: summary,
      ...extra,
    })
  }
  let result
  try {
    try {
      const createSnap = opts && opts.createFirmwareSnapshot ? opts.createFirmwareSnapshot : createFirmwareSnapshot
      snapshot = createSnap({
        sourcePath: record.path,
        stagingRoot,
        taskId: task.id,
        expectedSha256: record.sha256,
        expectedSize: record.size,
      })
    } catch (error) {
      result = await failFlash(error)
      return result
    }
    if (!snapshot || typeof snapshot !== 'object') {
      result = await failFlash('固件快照失败')
      return result
    }
    if (snapshot.ok === false) {
      const summary = snapshot.error || '固件快照失败'
      await completeTaskOnce({ ok: false, summary, errors: [summary] })
      result = withAudit({
        ...snapshot,
        ok: false,
        errorCode: snapshot.errorCode || FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_FAILED,
        error: summary,
      })
      return result
    }
    let ran
    try {
      ran = await (opts && opts.runOpenOcdFlash ? opts.runOpenOcdFlash : runOpenOcdFlash)(
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
    } catch (error) {
      result = await failFlash(error)
      return result
    }
    if (!isOpenOcdRunnerResult(ran)) {
      result = await failFlash('OpenOCD 无结果')
      return result
    }
    if (ran.cancelled) {
      await completeTaskOnce({ cancelled: true, summary: '烧录已取消' })
      result = withAudit({
        ok: false,
        cancelled: true,
        errorCode: ran.errorCode || FLASH_ERROR_CODES.FLASH_CANCELLED,
        error: '已取消',
      })
      return result
    }
    try {
      const details = ran.details && typeof ran.details === 'object' ? ran.details : {}
      const ok = ran.ok === true
      const summary = ran.summary || '烧录失败 ' + (ran.error || '')
      const tail = String((details.output || ran.error || '').split('\n').pop() || '').slice(0, 240)
      await completeTaskOnce({
        ok,
        summary,
        phase: 'flash',
        errors: ok ? [] : [tail],
        keil: { download: record.path },
      })
      result = withAudit({
        ...ran,
        ok,
        summary,
      })
      return result
    } catch (error) {
      result = await failFlash(error)
      return result
    }
  } catch (error) {
    result = await failFlash(error)
    return result
  } finally {
    try {
      if (snapshot && snapshot.dir) {
        const cleaned = (opts && opts.removeFirmwareSnapshot ? opts.removeFirmwareSnapshot : removeFirmwareSnapshot)(
          snapshot.dir,
          stagingRoot,
        )
        if (result && cleaned && cleaned.ok === false) {
          result.warnings = [
            ...(result.warnings || []),
            { code: cleaned.errorCode, message: cleaned.error || '快照清理失败' },
          ]
        }
      }
    } catch (cleanupError) {
      if (result) {
        result.warnings = [
          ...(result.warnings || []),
          {
            code: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_CLEANUP_FAILED,
            message: safeFlashError(cleanupError),
          },
        ]
      }
    }
    if (!finished) {
      await completeTaskOnce({ ok: false, summary: '烧录失败', errors: ['烧录失败'] })
      if (!result) {
        result = withAudit({
          ok: false,
          errorCode: FLASH_ERROR_CODES.FLASH_FAILED,
          error: '烧录失败',
        })
      }
    }
  }
}
