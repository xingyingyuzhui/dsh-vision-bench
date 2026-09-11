// @ts-check

import { spawnManagedProcess } from '../process/debug-process.mjs'
import { parseMILine } from './mi-parser.mjs'

/**
 * Encodes an argument for GDB/MI protocol.
 * Rejects raw CR/LF/NUL to prevent command injection, and escapes backslashes and quotes.
 *
 * @param {any} arg
 * @returns {string}
 */
export function encodeMiArg(arg) {
  const str = String(arg ?? '')
  if (/[\r\n\0]/.test(str)) {
    throw new Error('GDB MI 参数包含非法换行符或控制字符')
  }
  if (str.length === 0) {
    return '""'
  }
  if (/[\s"\\]/.test(str)) {
    const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `"${escaped}"`
  }
  return str
}

/**
 * GDB MI Client managing request-response correlation, timeouts,
 * stream subscriptions, and async event dispatching.
 */
export class MIClient {
  /**
   * @param {{
   *   proc?: {
   *     child?: import('node:child_process').ChildProcess,
   *     write?: (text: string) => void,
   *     stop?: () => Promise<void>,
   *     exitPromise?: Promise<{ code: number | null, signal: string | null }>,
   *   },
   *   transport?: {
   *     write: (text: string) => void,
   *     stop?: () => Promise<void>,
   *     exitPromise?: Promise<any>,
   *   },
   *   bin?: string,
   *   args?: string[],
   *   cwd?: string,
   *   env?: Record<string, string>,
   *   signal?: AbortSignal,
   *   defaultTimeoutMs?: number,
   *   onStdout?: (line: string) => void,
   *   onStderr?: (line: string) => void,
   * }} [options]
   */
  constructor(options = {}) {
    this._tokenCounter = 1
    /** @type {Map<number, { resolve: (rec: import('./mi-record.mjs').MIRecord) => void, reject: (err: any) => void, timer: NodeJS.Timeout | null, cmd: string, args: Array<string | number> }>} */
    this._pending = new Map()
    /** @type {Set<(rec: import('./mi-record.mjs').MIRecord) => void>} */
    this._recordListeners = new Set()
    /** @type {Set<(rec: import('./mi-record.mjs').MIRecord) => void>} */
    this._streamListeners = new Set()
    /**
     * Rolling tail of GDB console/target/log stream text.
     *
     * GDB explains MI failures on its console stream far more often than it
     * does inside `^error,msg=...`. Without this, a rejected command leaves the
     * caller with a terse message and no context.
     *
     * @type {string[]}
     */
    this._recentStreams = []
    /**
     * Rolling tail of the GDB process's raw stderr.
     * @type {string[]}
     */
    this._recentStderr = []
    this._defaultTimeoutMs = options.defaultTimeoutMs || 10000
    this._stopped = false

    if (options.transport) {
      this._transport = options.transport
    } else if (options.proc) {
      this._proc = options.proc
      this._transport = {
        write: (/** @type {string} */ text) => {
          if (typeof options.proc?.write === 'function') {
            options.proc.write(text)
          } else if (options.proc?.child?.stdin?.writable) {
            options.proc.child.stdin.write(text)
          } else {
            throw new Error('GDB process stdin is not writable')
          }
        },
        stop: options.proc.stop,
        exitPromise: options.proc.exitPromise,
      }
    } else if (options.bin) {
      const managed = spawnManagedProcess({
        bin: options.bin,
        args: options.args,
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        onStdout: (line) => {
          options.onStdout?.(line)
          this.handleLine(line)
        },
        onStderr: (line) => {
          options.onStderr?.(line)
          this._rememberStderr(line)
        },
      })
      this._proc = managed
      this._transport = {
        write: (/** @type {string} */ text) => {
          if (managed.child.stdin?.writable) {
            managed.child.stdin.write(text)
          } else {
            throw new Error('GDB process stdin is not writable')
          }
        },
        stop: () => managed.stop(),
        exitPromise: managed.exitPromise,
      }
    } else {
      this._transport = null
    }

    if (this._transport?.exitPromise) {
      this._transport.exitPromise.then(
        () => this._rejectAllPending(new Error('GDB 进程已退出')),
        (err) => this._rejectAllPending(err),
      )
    }
  }

  /**
   * Dispatches an incoming stdout line from GDB into parsed MI records.
   * @param {string} line
   */
  handleLine(line) {
    const record = parseMILine(line)
    if (!record) return

    // Stream records
    if (record.kind === 'console-stream' || record.kind === 'target-stream' || record.kind === 'log-stream') {
      this._rememberStream(record)
      for (const listener of this._streamListeners) {
        try {
          listener(record)
        } catch {
          /* ignore listener error */
        }
      }
    }

    // Correlate result record by token
    if (record.token !== null && this._pending.has(record.token)) {
      const req = this._pending.get(record.token)
      this._pending.delete(record.token)
      if (req) {
        if (req.timer) clearTimeout(req.timer)
        if (record.class === 'error') {
          const msg = record.results?.msg || `GDB 命令失败: ${req.cmd}`
          /** @type {any} */
          const err = new Error(msg)
          err.record = record
          err.errorCode = 'GDB_MI_ERROR'
          err.miCommand = req.cmd
          err.miArgs = req.args
          // Attach the GDB context that explains *why* the command failed.
          // `Undefined command: ""monitor".` on its own looks like a typo; with
          // the console stream attached it is obvious the argument was quoted
          // one level too deep.
          err.gdbStream = this._recentStreams.slice(-20)
          err.gdbStderr = this._recentStderr.slice(-20)
          req.reject(err)
        } else {
          req.resolve(record)
        }
      }
    }

    // Dispatch to record listeners
    for (const listener of this._recordListeners) {
      try {
        listener(record)
      } catch {
        /* ignore listener error */
      }
    }
  }

  /**
   * Executes an MI command and awaits its result record.
   *
   * @param {string} cmd
   * @param {Array<string | number>} [args]
   * @param {{
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   * }} [options]
   * @returns {Promise<import('./mi-record.mjs').MIRecord>}
   */
  async command(cmd, args = [], options = {}) {
    if (this._stopped) {
      throw new Error('GDB MI Client 已停止，无法执行新命令')
    }
    if (options.signal?.aborted) {
      throw new Error('GDB MI 命令已取消')
    }
    if (!this._transport) {
      throw new Error('未配置 GDB MI transport')
    }
    const transport = this._transport

    const token = this._tokenCounter++
    const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs

    const formattedArgs = (args || []).map(encodeMiArg).join(' ')

    const commandLine = formattedArgs ? `${token}${cmd} ${formattedArgs}\n` : `${token}${cmd}\n`

    return new Promise((resolve, reject) => {
      /** @type {NodeJS.Timeout | null} */
      let timer = null
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this._pending.delete(token)
          reject(new Error(`GDB MI 命令超时 (${timeoutMs}ms): ${cmd}`))
        }, timeoutMs)
      }

      /** @type {(() => void) | null} */
      let abortHandler = null
      if (options.signal) {
        abortHandler = () => {
          this._pending.delete(token)
          if (timer) clearTimeout(timer)
          reject(new Error('GDB MI 命令已取消'))
        }
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }

      this._pending.set(token, {
        resolve: (rec) => {
          if (abortHandler && options.signal) {
            options.signal.removeEventListener('abort', abortHandler)
          }
          resolve(rec)
        },
        reject: (err) => {
          if (abortHandler && options.signal) {
            options.signal.removeEventListener('abort', abortHandler)
          }
          reject(err)
        },
        timer,
        cmd,
        args: (args || []).map((a) => String(a)),
      })

      try {
        transport.write(commandLine)
      } catch (err) {
        this._pending.delete(token)
        if (timer) clearTimeout(timer)
        if (abortHandler && options.signal) {
          options.signal.removeEventListener('abort', abortHandler)
        }
        reject(err)
      }
    })
  }

  /**
   * Subscribes to all MI records (result, async, stream).
   * @param {(rec: import('./mi-record.mjs').MIRecord) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onRecord(listener) {
    this._recordListeners.add(listener)
    return () => {
      this._recordListeners.delete(listener)
    }
  }

  /**
   * Subscribes to stream records (~console, @target, &log).
   * @param {(rec: import('./mi-record.mjs').MIRecord) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onStream(listener) {
    this._streamListeners.add(listener)
    return () => {
      this._streamListeners.delete(listener)
    }
  }

  /**
   * Subscribes specifically to async exec/notify records.
   * @param {(rec: import('./mi-record.mjs').MIRecord) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onAsync(listener) {
    return this.onRecord((rec) => {
      if (rec.kind === 'exec-async' || rec.kind === 'notify-async' || rec.kind === 'status-async') {
        listener(rec)
      }
    })
  }

  /**
   * Records a stream record's text into the rolling diagnostic tail.
   * @private
   * @param {any} record
   */
  _rememberStream(record) {
    const text = String(record?.payload?.text ?? record?.results?.text ?? record?.text ?? '').trim()
    if (!text) return
    this._recentStreams.push(text)
    if (this._recentStreams.length > 50) this._recentStreams.shift()
  }

  /**
   * Records a raw GDB stderr line into the rolling diagnostic tail.
   * @private
   * @param {string} line
   */
  _rememberStderr(line) {
    const text = String(line ?? '').trim()
    if (!text) return
    this._recentStderr.push(text)
    if (this._recentStderr.length > 50) this._recentStderr.shift()
  }

  /**
   * @private
   * @param {any} err
   */
  _rejectAllPending(err) {
    for (const req of this._pending.values()) {
      if (req.timer) clearTimeout(req.timer)
      req.reject(err)
    }
    this._pending.clear()
  }

  /**
   * Stops the client and releases underlying child process.
   */
  async stop() {
    this._stopped = true
    this._rejectAllPending(new Error('GDB MI Client 已停止'))
    if (this._transport?.stop) {
      await this._transport.stop()
    }
  }
}

/**
 * Creates an instance of MIClient.
 * @param {ConstructorParameters<typeof MIClient>[0]} [options]
 */
export function createMiClient(options) {
  return new MIClient(options)
}
