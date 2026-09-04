// @ts-check
import { spawn } from 'node:child_process'
import { killProcessTree } from '../../../../bench-run.mjs'

/**
 * Spawns a session-scoped managed child process with line framing,
 * process tree cleanup, stderr tail buffer, and idempotent stop.
 *
 * @param {{
 *   bin: string,
 *   args?: string[],
 *   cwd?: string,
 *   env?: Record<string, string>,
 *   signal?: AbortSignal,
 *   onStdout?: (line: string) => void,
 *   onStderr?: (line: string) => void,
 *   onExit?: (code: number | null, signal: string | null) => void,
 *   readyPredicate?: (line: string) => boolean,
 *   readyTimeoutMs?: number,
 *   stderrMaxLines?: number,
 * }} options
 */
export function spawnManagedProcess(options) {
  const {
    bin,
    args = [],
    cwd,
    env = process.env,
    signal,
    onStdout,
    onStderr,
    onExit,
    readyPredicate,
    readyTimeoutMs = 15000,
    stderrMaxLines = 50,
  } = options

  /** @type {string[]} */
  const stderrTail = []
  let stopped = false
  let isReady = !readyPredicate
  /** @type {((val: boolean) => void) | null} */
  let readyResolve = null
  /** @type {((err: Error) => void) | null} */
  let readyReject = null
  /** @type {NodeJS.Timeout | null} */
  let readyTimer = null

  const readyPromise = readyPredicate
    ? new Promise((resolve, reject) => {
        readyResolve = resolve
        readyReject = reject
        if (readyTimeoutMs > 0) {
          readyTimer = setTimeout(() => {
            reject(new Error(`进程就绪超时 (${readyTimeoutMs}ms): ${bin}`))
          }, readyTimeoutMs)
        }
      })
    : Promise.resolve(true)

  const child = spawn(bin, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdoutRemainder = ''
  let stderrRemainder = ''

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    stdoutRemainder += chunk
    const lines = stdoutRemainder.split(/\r?\n/)
    stdoutRemainder = lines.pop() || ''
    for (const line of lines) {
      if (line) {
        if (!isReady && readyPredicate && readyPredicate(line)) {
          isReady = true
          if (readyTimer) clearTimeout(readyTimer)
          readyResolve?.(true)
        }
        onStdout?.(line)
      }
    }
  })

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    stderrRemainder += chunk
    const lines = stderrRemainder.split(/\r?\n/)
    stderrRemainder = lines.pop() || ''
    for (const line of lines) {
      if (line) {
        stderrTail.push(line.slice(0, 240))
        if (stderrTail.length > stderrMaxLines) {
          stderrTail.shift()
        }
        if (!isReady && readyPredicate && readyPredicate(line)) {
          isReady = true
          if (readyTimer) clearTimeout(readyTimer)
          readyResolve?.(true)
        }
        onStderr?.(line)
      }
    }
  })

  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, exitSignal) => {
      if (readyTimer) clearTimeout(readyTimer)
      if (!isReady && readyReject) {
        const lastErr = stderrTail.slice(-5).join('; ')
        readyReject(new Error(`进程在就绪前退出 (code=${code}): ${lastErr || bin}`))
      }
      onExit?.(code, exitSignal)
      resolve({ code, signal: exitSignal, stderrTail })
    })

    child.once('error', (err) => {
      if (readyTimer) clearTimeout(readyTimer)
      if (!isReady && readyReject) {
        readyReject(err)
      }
      resolve({ code: 1, signal: null, error: err, stderrTail })
    })
  })

  const stop = () => {
    if (stopped) return
    stopped = true
    if (readyTimer) clearTimeout(readyTimer)
    if (child.pid) {
      killProcessTree(child.pid)
    }
  }

  if (signal) {
    if (signal.aborted) {
      stop()
    } else {
      signal.addEventListener('abort', stop, { once: true })
    }
  }

  return {
    pid: child.pid,
    child,
    readyPromise,
    exitPromise,
    getStderrTail: () => [...stderrTail],
    write: (/** @type {any} */ data) => {
      if (!stopped && child.stdin?.writable) {
        child.stdin.write(data)
      }
    },
    stop,
  }
}
