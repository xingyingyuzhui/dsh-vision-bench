import { join } from 'node:path'
import { pickArtifact } from './bench-fs.mjs'
import { aborted, originOf, signalOf } from './bench-journal.mjs'
import { requireKeilProject, requireWorkspaceCwd } from './bench-paths.mjs'
import { finishTask, loadBindings, loadWorkspace, openExclusiveTask, pruneBuildLogs } from './bench-store.mjs'

import { runPythonScript } from './bench-run.mjs'
import { storeDir } from './bench-store.mjs'

const needPython = (bindings) => {
  if (!bindings.python) return '请先在设置 → Vision 绑定 Python'
  return null
}

const needUv4 = (bindings) => {
  if (!bindings.uv4) return '请先在设置 → Vision 绑定 Keil UV4'
  return null
}

export {
  keilScan,
  keilTargets,
  keilMap,
} from './src/application/keil/project-service.mjs'

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
  if (keil.error)
    return { ok: false, error: keil.error === '工程必须是绝对路径' ? '请先在工作区里选择 Keil 工程' : keil.error }
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
      summary: '编译 ' + (target || keil.project),
    },
    { conflicts: ['build', 'download'] },
  )
  if (!opened.ok) return opened
  const task = opened.task
  let finished = false
  const finish = opts && typeof opts.finishTask === 'function' ? opts.finishTask : finishTask
  const completeTaskOnce = async (patch) => {
    if (finished) return
    finished = true
    await finish(home, room.cwd, task.id, patch)
  }
  try {
    const runner = opts && typeof opts.runPythonScript === 'function' ? opts.runPythonScript : runPythonScript
    const ran = await runner(
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
    if (!ran || typeof ran !== 'object') {
      await completeTaskOnce({ ok: false, summary: '编译失败', errors: ['编译失败'] })
      return { ok: false, error: '编译失败', taskId: task.id, source: origin.source }
    }
    if (ran.cancelled) {
      await completeTaskOnce({ cancelled: true, summary: '编译已取消' })
      return { ok: false, cancelled: true, error: '已取消', taskId: task.id, source: origin.source }
    }
    const details = ran.result && ran.result.details ? ran.result.details : {}
    const download = pickArtifact(details, artifact)
    const ok = ran.ok && (!ran.result || ran.result.status !== 'error')
    const summary =
      ((ran.result && ran.result.summary) || (ok ? '编译成功' : '编译失败 ' + (ran.error || ''))) +
      (download.path ? ' → ' + download.path : '')
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
