import { createInterface } from 'node:readline'
import {
  decodeNdjsonLine,
  encodeNdjson,
  IO_PROTOCOL_V,
  sanitizeIoError,
  toEndpoint,
  validateIoRequest,
} from '../bench-io-contract.mjs'
import { createConnectionManager } from './io/connection-manager.mjs'
import { loadModbusRuntime, loadSerialPort } from './io/modbus-driver.mjs'

const write = (obj) => {
  process.stdout.write(encodeNdjson(obj))
}

const fail = (id, error) => write({
  v: IO_PROTOCOL_V,
  id,
  ok: false,
  error: sanitizeIoError(error),
  frames: error && error.frames ? error.frames : undefined,
  durationMs: error && error.durationMs,
  transactionId: error && error.transactionId,
})

const runtime = await loadModbusRuntime()
const serial = await loadSerialPort()
const manager = createConnectionManager({
  ModbusRTU: runtime.ModbusRTU,
})

const pendingAbort = new Map()

const replyHealth = (id) => write({
  v: IO_PROTOCOL_V,
  id,
  ok: true,
  data: {
    protocol: IO_PROTOCOL_V,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    modbusSerial: runtime.info.modbusSerial,
    serialport: runtime.info.serialport || serial.error,
    tcp: runtime.info.tcp,
    rtu: runtime.info.rtu && !!serial.SerialPort,
    tcpError: runtime.info.tcpError,
    rtuError: runtime.info.rtuError || serial.error,
  },
})

const handle = async (msg) => {
  const checked = validateIoRequest(msg)
  const id = (msg && msg.id) || 'unknown'
  if (!checked.ok) {
    fail(id, checked.error)
    return
  }
  if (msg.op === 'health') {
    replyHealth(id)
    return
  }
  if (msg.op === 'cancel') {
    const target = String(msg.targetId || '')
    const ac = pendingAbort.get(target)
    if (ac) ac.abort()
    write({ v: IO_PROTOCOL_V, id, ok: true, data: { cancelled: true } })
    return
  }
  if (msg.op === 'shutdown') {
    await manager.stop()
    write({ v: IO_PROTOCOL_V, id, ok: true, data: { stopped: true } })
    process.exit(0)
  }
  const ac = new AbortController()
  pendingAbort.set(id, ac)
  try {
    if (msg.op === 'modbus.read' || msg.op === 'modbus.write') {
      const endpoint = toEndpoint({ conn: msg.endpoint })
      const ran = await manager.modbus({ ...msg, source: msg.source || 'manual' }, endpoint, ac.signal)
      write({
        v: IO_PROTOCOL_V,
        id,
        ok: true,
        data: ran.data,
        frames: ran.frames,
        durationMs: ran.durationMs,
        transactionId: ran.transactionId,
      })
      return
    }
    if (msg.op === 'connection.open') {
      const endpoint = toEndpoint({ conn: msg.endpoint || msg })
      const ran = await manager.openConnection(msg, endpoint, ac.signal)
      write({ v: IO_PROTOCOL_V, id, ok: true, data: ran })
      return
    }
    if (msg.op === 'connection.close' || msg.op === 'release') {
      const ran = await manager.closeConnection(msg.cwd, msg.connectionId)
      write({ v: IO_PROTOCOL_V, id, ok: true, data: ran })
      return
    }
    if (msg.op === 'connection.status') {
      const ran = manager.status(msg.cwd, msg.connectionId)
      write({ v: IO_PROTOCOL_V, id, ok: true, data: ran })
      return
    }
    if (msg.op === 'serial.capture.feed') {
      const ran = manager.feedCapture(msg.cwd, msg.connectionId, msg.since, msg.max)
      write({ v: IO_PROTOCOL_V, id, ok: true, data: ran })
      return
    }
  } catch (error) {
    fail(id, error)
  } finally {
    pendingAbort.delete(id)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (Buffer.byteLength(line) > 64 * 1024) {
    fail('protocol', { code: 'PROTOCOL_VIOLATION', message: '报文超过 64 KiB' })
    process.exit(2)
  }
  const parsed = decodeNdjsonLine(line)
  if (!parsed.ok) {
    fail('protocol', parsed.error)
    return
  }
  void handle(parsed.value)
})

const shutdown = async () => {
  try { await manager.stop() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
