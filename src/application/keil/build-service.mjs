// @ts-check
import { join } from 'node:path'
import { pickArtifact } from '../../../bench-fs.mjs'
import { aborted, originOf, signalOf } from '../../../bench-journal.mjs'
import { requireKeilProject, requireWorkspaceCwd } from '../../../bench-paths.mjs'
import {
  finishTask,
  loadBindings,
  loadWorkspace,
  openExclusiveTask,
  pruneBuildLogs,
  storeDir,
} from '../../../bench-store.mjs'
import { runUv4Build } from '../../infrastructure/keil/uv4-build-runner.mjs'

/**
 * Checks if Keil UV4 binding is configured.
 *
 * @param {{ uv4?: string }} bindings
 * @returns {string | null}
 */
const needUv4 = (bindings) => {
  if (!bindings.uv4) return '请先在设置 → Vision 绑定 Keil UV4'
  return null
}

/**
 * Builds a Keil project target and manages task lifecycle.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} body
 * @param {any} [opts]
 * @returns {Promise<any>}
 */
export const keilBuild = async (home, cwd, body, opts) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error || !room.cwd) return { ok: false, error: room.error || '需要工作区目录' }
  const bindings = loadBindings(home)
  const missing = needUv4(bindings)
  if (missing) return { ok: false, error: missing }
  const workspace = loadWorkspace(home, room.cwd)
  const project = body?.project || workspace.keil.project
  const target = body?.target || workspace.keil.target
  const artifact = body?.artifact || workspace.keil.artifact
  const keil = /** @type {any} */ (requireKeilProject(room.cwd, project))
  if (keil.error) {
    return {
      ok: false,
      error: keil.error === '工程必须是绝对路径' ? '请先在工作区里选择 Keil 工程' : keil.error,
    }
  }
  const signal = signalOf(body, opts)
  if (aborted(signal)) return { ok: false, cancelled: true, error: '已取消' }
  const origin = originOf(body)
  const opened = await openExclusiveTask(
    home,
    room.cwd,
    {
      type: 'build',
      source: origin.source,
      sessionId: origin.sessionId,
      summary: `编译 ${target || keil.project}`,
    },
    { conflicts: ['build', 'download'] },
  )
  if (!opened.ok || !opened.task) return opened
  const task = opened.task
  let finished = false
  const finish = opts && typeof opts.finishTask === 'function' ? opts.finishTask : finishTask
  const completeTaskOnce = async (/** @type {any} */ patch) => {
    if (finished) return
    finished = true
    await finish(home, room.cwd, task.id, patch)
  }

  try {
    let ran
    if (opts && typeof opts.runPythonScript === 'function') {
      // Backward compatibility hook for test doubles passing runPythonScript
      ran = await opts.runPythonScript(
        bindings.python,
        'keil_build.py',
        [
          '--uv4',
          bindings.uv4,
          '--project',
          keil.project,
          '--target',
          target || '',
          '--log-dir',
          join(storeDir(home), 'logs'),
          '--task-id',
          task.id,
          '--json',
        ],
        { cwd: room.cwd, timeoutMs: 620000, signal },
      )
    } else {
      const runner = opts && typeof opts.runUv4Build === 'function' ? opts.runUv4Build : runUv4Build
      ran = await runner({
        uv4: bindings.uv4,
        project: keil.project,
        target: target || '',
        logDir: join(storeDir(home), 'logs'),
        taskId: task.id,
        signal,
        runExec: opts?.runExecFile,
      })
    }

    if (!ran || typeof ran !== 'object') {
      await completeTaskOnce({ ok: false, summary: '编译失败', errors: ['编译失败'] })
      return { ok: false, error: '编译失败', taskId: task.id, source: origin.source }
    }
    if (ran.cancelled) {
      await completeTaskOnce({ cancelled: true, summary: '编译已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source }
    }

    const details = ran.result?.details ? ran.result.details : {}
    const download = pickArtifact(details, artifact)
    const ok = ran.ok && (!ran.result || ran.result.status !== 'error')
    const summary =
      (ran.result?.summary || (ok ? '编译成功' : `编译失败 ${ran.error || ''}`)) +
      (download.path ? ` → ${download.path}` : '')

    await completeTaskOnce({
      ok,
      summary,
      logFile: details.log_file || '',
      phase: details.phase || '',
      errors: Array.isArray(details.errors) ? details.errors : [],
      keil: { download: download.path || '' },
    })

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
  } catch (error) {
    const summary = (error instanceof Error ? error.message : String(error || '编译失败')).slice(0, 240)
    await completeTaskOnce({ ok: false, summary, errors: [summary] })
    return { ok: false, error: summary, taskId: task.id, source: origin.source }
  } finally {
    if (!finished) {
      await completeTaskOnce({ ok: false, summary: '编译失败', errors: ['编译失败'] })
    }
    try {
      pruneBuildLogs(home)
    } catch {
      /* retention is best-effort */
    }
  }
}
