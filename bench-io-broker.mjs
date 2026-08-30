import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capabilitiesFromHealth, idleIoSnapshot } from './bench-io-capability.mjs'
import {
  IO_HANDSHAKE_MS,
  IO_MAX_LINE,
  IO_PROTOCOL_V,
  IO_RUNTIME_PACKAGES,
  clampTimeoutMs,
  decodeNdjsonLine,
  encodeNdjson,
  ioError,
  sanitizeIoError,
} from './bench-io-contract.mjs'
import { killProcessTree } from './bench-run.mjs'

const DEFAULT_WORKER = join(dirname(fileURLToPath(import.meta.url)), 'runtime', 'vision-io-worker.mjs')
const OUTBOUND_CAP = 32
const RESTART_WINDOW_MS = 60_000
const STDERR_CAP = 4000

const settlePending = (entry, result) => {
  if (!entry || entry.settled) return
  entry.settled = true
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.abortCleanup) entry.abortCleanup()
  if (result.ok) entry.resolve(result)
  else {
    const error = result.error || ioError('IO_RUNTIME_CRASHED', 'I/O 运行时失败')
    if (result.frames) error.frames = result.frames
    if (result.transactionId) error.transactionId = result.transactionId
    if (result.durationMs != null) error.durationMs = result.durationMs
    entry.reject(error)
  }
}

export function createVisionIoBroker(options = {}) {
  const workerPath = options.workerPath || DEFAULT_WORKER
  const execPath = options.execPath || process.execPath
  const env = options.env || process.env
  let child = null
  let state = 'idle'
  let workerEpoch = 0
  let seq = 0
  let stdoutBuf = ''
  let stderrTail = ''
  let lastError = null
  let cachedCaps = idleIoSnapshot().capabilities
  const pending = new Map()
  const startingQueue = []
  const outbound = []
  let draining = false
  let lastCrashAt = 0
  let healthCache = null
  let stopping = null

  const nextId = () => 'req-' + Date.now().toString(36) + '-' + ++seq

  const writeStdin = (obj) => {
    if (!child || !child.stdin || child.stdin.destroyed) return false
    const line = encodeNdjson(obj)
    if (draining || outbound.length) {
      if (outbound.length >= OUTBOUND_CAP) return false
      outbound.push(line)
      return true
    }
    let ok = true
    try {
      ok = child.stdin.write(line)
    } catch {
      return false
    }
    if (!ok) {
      draining = true
      child.stdin.once('drain', () => {
        draining = false
        while (outbound.length && child && child.stdin && !child.stdin.destroyed) {
          const next = outbound.shift()
          let more = true
          try {
            more = child.stdin.write(next)
          } catch {
            break
          }
          if (!more) {
            draining = true
            child.stdin.once('drain', () => {
              draining = false
            })
            break
          }
        }
      })
    }
    return true
  }

  const sendCancel = (targetId) => {
    if (!targetId) return
    writeStdin({ v: IO_PROTOCOL_V, id: nextId(), op: 'cancel', targetId })
  }

  const failAll = (error, withCancel = false) => {
    const err = sanitizeIoError(error)
    lastError = err
    for (const [id, entry] of pending) {
      pending.delete(id)
      if (withCancel) sendCancel(id)
      settlePending(entry, { ok: false, error: err })
    }
    const queued = startingQueue.splice(0)
    for (const item of queued) item.reject(err)
    outbound.length = 0
  }

  const handleLine = (line) => {
    const parsed = decodeNdjsonLine(line)
    if (!parsed.ok) {
      killWorker(ioError('PROTOCOL_VIOLATION', parsed.error.message))
      return
    }
    const msg = parsed.value
    if (!msg || typeof msg.id !== 'string') return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok === true) {
      settlePending(entry, { ok: true, ...msg })
    } else {
      settlePending(entry, {
        ok: false,
        error: sanitizeIoError(msg.error),
        frames: msg.frames,
        transactionId: msg.transactionId,
        durationMs: msg.durationMs,
      })
    }
  }

  const onStdout = (chunk) => {
    stdoutBuf += String(chunk || '')
    let idx
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx)
      stdoutBuf = stdoutBuf.slice(idx + 1)
      if (Buffer.byteLength(line) > IO_MAX_LINE) {
        killWorker(ioError('PROTOCOL_VIOLATION', '报文超过 64 KiB'))
        return
      }
      handleLine(line)
    }
    if (Buffer.byteLength(stdoutBuf) > IO_MAX_LINE) {
      killWorker(ioError('PROTOCOL_VIOLATION', '报文超过 64 KiB'))
    }
  }

  const killWorker = (error) => {
    const childRef = child
    child = null
    state = error ? 'unhealthy' : 'stopped'
    lastError = sanitizeIoError(error || ioError('IO_RUNTIME_CRASHED', 'I/O 运行时已停止'))
    cachedCaps = {
      modbusTcp: 'unavailable',
      modbusRtu: 'unavailable',
      serialMonitor: 'unavailable',
    }
    failAll(lastError)
    if (childRef && childRef.pid) killProcessTree(childRef.pid)
    healthCache = null
  }

  const spawnWorker = () =>
    new Promise((resolve, reject) => {
      if (state === 'ready' && child) {
        resolve(healthCache)
        return
      }
      if (state === 'unhealthy' && Date.now() - lastCrashAt < RESTART_WINDOW_MS) {
        reject(ioError('IO_RUNTIME_UNAVAILABLE', 'I/O 运行时熔断中'))
        return
      }
      state = 'starting'
      workerEpoch += 1
      const epoch = workerEpoch
      let proc
      try {
        proc = spawn(execPath, [workerPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env,
        })
      } catch (error) {
        state = 'unhealthy'
        lastCrashAt = Date.now()
        lastError = ioError('IO_RUNTIME_UNAVAILABLE', String((error && error.message) || error))
        reject(lastError)
        return
      }
      child = proc
      stdoutBuf = ''
      stderrTail = ''
      draining = false
      outbound.length = 0
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', onStdout)
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + String(chunk || '')).slice(-STDERR_CAP)
      })
      proc.on('error', (error) => {
        if (workerEpoch !== epoch) return
        lastCrashAt = Date.now()
        lastError = ioError('IO_RUNTIME_UNAVAILABLE', String((error && error.message) || error))
        killWorker(lastError)
      })
      proc.on('exit', () => {
        if (workerEpoch !== epoch) return
        lastCrashAt = Date.now()
        killWorker(ioError('IO_RUNTIME_CRASHED', 'I/O 运行时退出'))
      })
      const handshakeId = 'health-' + epoch
      const timer = setTimeout(() => {
        pending.delete(handshakeId)
        lastCrashAt = Date.now()
        lastError = ioError('IO_RUNTIME_UNAVAILABLE', 'I/O 运行时握手超时')
        killWorker(lastError)
        reject(lastError)
      }, IO_HANDSHAKE_MS)
      pending.set(handshakeId, {
        resolve: (msg) => {
          clearTimeout(timer)
          const data = msg && msg.data ? msg.data : {}
          if (Number(data.protocol) !== IO_PROTOCOL_V || Number(msg.v) !== IO_PROTOCOL_V) {
            lastCrashAt = Date.now()
            lastError = ioError('PROTOCOL_VIOLATION', '协议版本不符')
            killWorker(lastError)
            reject(lastError)
            return
          }
          healthCache = data
          cachedCaps = capabilitiesFromHealth(data)
          lastError = null
          state = 'ready'
          resolve(data)
          const queued = startingQueue.splice(0)
          for (const item of queued) item.resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          lastCrashAt = Date.now()
          state = 'unhealthy'
          lastError = sanitizeIoError(error)
          reject(lastError)
        },
        timer,
        abortCleanup: () => {},
        workerEpoch: epoch,
        settled: false,
      })
      if (!writeStdin({ v: IO_PROTOCOL_V, id: handshakeId, op: 'health' })) {
        clearTimeout(timer)
        pending.delete(handshakeId)
        lastCrashAt = Date.now()
        lastError = ioError('IO_RUNTIME_UNAVAILABLE', '无法写入 I/O 运行时')
        killWorker(lastError)
        reject(lastError)
      }
    })

  const ensureReady = () => {
    if (state === 'ready' && child) return Promise.resolve(healthCache)
    if (state === 'starting') {
      return new Promise((resolve, reject) => {
        if (startingQueue.length >= OUTBOUND_CAP) {
          reject(ioError('IO_BACKPRESSURE', 'I/O 运行时正忙'))
          return
        }
        startingQueue.push({
          resolve: () => resolve(healthCache),
          reject,
        })
      })
    }
    return spawnWorker()
  }

  const request = async (payload, opts = {}) => {
    await ensureReady()
    if (state !== 'ready' || !child) {
      throw ioError('IO_RUNTIME_UNAVAILABLE', 'I/O 运行时不可用')
    }
    if (pending.size >= OUTBOUND_CAP) {
      throw ioError('IO_BACKPRESSURE', 'I/O 队列已满')
    }
    const id = payload.id || nextId()
    const timeoutMs = clampTimeoutMs(opts.timeoutMs, payload.timeoutMs || 8000)
    const signal = opts.signal
    const epoch = workerEpoch
    return new Promise((resolve, reject) => {
      let cancelSent = false
      const sendCancelOnce = () => {
        if (cancelSent) return
        cancelSent = true
        sendCancel(id)
      }
      const abortCleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort)
      }
      const finish = (error, code) => {
        if (entry.settled) return
        pending.delete(id)
        sendCancelOnce()
        settlePending(entry, { ok: false, error: ioError(code, error) })
      }
      const onAbort = () => finish('已取消', 'CANCELLED')
      const timer = setTimeout(() => finish('I/O 超时', 'MODBUS_TIMEOUT'), timeoutMs)
      const entry = {
        resolve: (msg) => resolve(msg),
        reject,
        timer,
        abortCleanup,
        workerEpoch: epoch,
        settled: false,
      }
      pending.set(id, entry)
      if (signal) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      if (!writeStdin({ v: IO_PROTOCOL_V, ...payload, id })) {
        pending.delete(id)
        settlePending(entry, { ok: false, error: ioError('IO_BACKPRESSURE', 'I/O 队列已满') })
      }
    })
  }

  const stop = async (reason = 'plugin-dispose') => {
    if (stopping) return stopping
    if (state === 'idle' || state === 'stopped') return
    state = 'stopping'
    stopping = (async () => {
      failAll(ioError('CANCELLED', 'I/O 运行时停止: ' + reason), true)
      const proc = child
      if (proc) {
        writeStdin({ v: IO_PROTOCOL_V, id: nextId(), op: 'shutdown' })
        await new Promise((resolve) => {
          const t = setTimeout(() => {
            if (proc.pid) killProcessTree(proc.pid)
            resolve()
          }, 1500)
          proc.once('exit', () => {
            clearTimeout(t)
            resolve()
          })
        })
      }
      child = null
      state = 'stopped'
      stopping = null
      cachedCaps = idleIoSnapshot().capabilities
    })()
    return stopping
  }

  return {
    request,
    sendCancel,
    async health() {
      try {
        const data = await ensureReady()
        return { ok: true, data }
      } catch (error) {
        return { ok: false, error: sanitizeIoError(error) }
      }
    },
    snapshot() {
      return {
        state,
        pid: (child && child.pid) || 0,
        protocol: IO_PROTOCOL_V,
        packages: { ...IO_RUNTIME_PACKAGES },
        capabilities: { ...cachedCaps },
        lastError,
        stderrTail: stderrTail.slice(0, STDERR_CAP),
      }
    },
    stop,
    getState: () => state,
    pendingSize: () => pending.size,
    pid: () => (child && child.pid) || 0,
  }
}

let singleton = null

export function getVisionIoBroker(options = {}) {
  if (options.broker) return options.broker
  if (!singleton) singleton = createVisionIoBroker(options)
  return singleton
}

export async function stopVisionIoBroker(reason = 'plugin-dispose') {
  if (!singleton) return
  const current = singleton
  singleton = null
  await current.stop(reason)
}
