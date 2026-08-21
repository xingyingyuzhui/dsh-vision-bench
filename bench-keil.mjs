import { join } from 'node:path'
import { pickArtifact } from './bench-fs.mjs'
import { requireKeilProject, requireWorkspaceCwd } from './bench-paths.mjs'
import { finishTask, loadBindings, loadWorkspace, openTask, pruneBuildLogs } from './bench-store.mjs'
import { aborted, hasRunning, originOf, signalOf } from './bench-journal.mjs'

import { runPythonScript } from './bench-run.mjs'
import { storeDir } from './bench-store.mjs'

const needPython = (bindings) => {
  if (!bindings.python) return '请先在设置 → 台架 绑定 Python'
  return null
}

const needUv4 = (bindings) => {
  if (!bindings.uv4) return '请先在设置 → 台架 绑定 Keil UV4'
  return null
}

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
    finishTask(home, room.cwd, task.id, { cancelled: true, summary: '编译已取消' })
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
    keil: { download: download.path || '' },
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
