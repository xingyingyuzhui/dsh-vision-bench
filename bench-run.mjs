import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
const SCRIPTS = {
  'keil_project.py': join(RUNTIME_DIR, 'keil_project.py'),
  'keil_build.py': join(RUNTIME_DIR, 'keil_build.py'),
  'modbus_read.py': join(RUNTIME_DIR, 'modbus_read.py'),
}

const pythonArgv = (pythonBin, extra) => {
  const name = basename(String(pythonBin).replace(/\\/g, '/')).toLowerCase()
  const prefix = name === 'py' || name === 'py.exe' ? ['-3'] : []
  return prefix.concat(extra)
}

const parseJsonStdout = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return { error: '脚本没有输出' }
  try {
    return { data: JSON.parse(raw) }
  } catch {
    const start = raw.lastIndexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return { data: JSON.parse(raw.slice(start, end + 1)) }
      } catch { /* fall through */ }
    }
    return { error: '脚本输出不是 JSON', preview: raw.slice(0, 400) }
  }
}

export const runExecFile = (bin, args, opts) => new Promise((resolve, reject) => {
  execFile(bin, args, {
    timeout: opts.timeoutMs,
    maxBuffer: opts.maxBuffer || 1024 * 1024,
    windowsHide: true,
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env || process.env,
  }, (error, stdout, stderr) => {
    if (error && error.code === 'ENOENT') {
      reject(new Error('无法启动: ' + bin))
      return
    }
    resolve({
      exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      timedOut: !!(error && error.killed),
      stdout: String(stdout || ''),
      stderr: String(stderr || (error && error.message) || ''),
    })
  })
})

export const runPythonScript = async (pythonBin, scriptName, args, opts = {}) => {
  if (!pythonBin) return { ok: false, error: '未绑定 Python' }
  if (!existsSync(pythonBin)) return { ok: false, error: 'Python 路径不存在: ' + pythonBin }
  const script = SCRIPTS[scriptName]
  if (!script || !existsSync(script)) return { ok: false, error: '脚本不存在: ' + scriptName }
  const argv = pythonArgv(pythonBin, [script, ...args])
  const ran = await runExecFile(pythonBin, argv, {
    timeoutMs: opts.timeoutMs || 30000,
    cwd: opts.cwd,
  })
  if (ran.timedOut) return { ok: false, error: '脚本超时' }
  const parsed = parseJsonStdout(ran.stdout)
  if (parsed.error) {
    const errText = (ran.stderr || parsed.preview || parsed.error).slice(0, 400)
    return { ok: false, error: parsed.error + (errText ? ': ' + errText : ''), exitCode: ran.exitCode }
  }
  const data = parsed.data
  if (data && data.status === 'error') {
    const message = data.error && data.error.message ? data.error.message : '脚本失败'
    return { ok: false, error: message, result: data, exitCode: ran.exitCode }
  }
  return { ok: true, result: data, exitCode: ran.exitCode }
}

export const _internal = { pythonArgv, parseJsonStdout, SCRIPTS, RUNTIME_DIR }
