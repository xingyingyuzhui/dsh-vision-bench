import {
  clampTimeoutMs,
  IO_CONNECT_TIMEOUT_MS,
  normalizeFrames,
  rtuParityName,
} from '../../bench-io-contract.mjs'
import { extractDebugFrames, mapDriverError } from './error-map.mjs'

export async function loadSerialPort() {
  try {
    const mod = await import('serialport')
    return { SerialPort: mod.SerialPort, error: '' }
  } catch (error) {
    return { SerialPort: null, error: String((error && error.message) || error).slice(0, 180) }
  }
}

export async function loadModbusRuntime() {
  const info = { tcp: false, rtu: false, modbusSerial: '', serialport: '', tcpError: '', rtuError: '' }
  let ModbusRTU = null
  try {
    const mod = await import('modbus-serial')
    ModbusRTU = mod.default || mod
    info.tcp = typeof ModbusRTU === 'function'
    info.modbusSerial = (mod.default && mod.default.version) || '8.0.25'
  } catch (error) {
    info.tcpError = String((error && error.message) || error).slice(0, 180)
  }
  try {
    await import('serialport')
    info.rtu = info.tcp
    info.serialport = '13.0.0'
  } catch (error) {
    info.rtu = false
    info.rtuError = String((error && error.message) || error).slice(0, 180)
  }
  return { ModbusRTU, info }
}

const asBools = (data) => (Array.isArray(data) ? data : []).map((v) => v === true || v === 1 || v === '1')
const asRegs = (data) => (Array.isArray(data) ? data : []).map((v) => (Number(v) & 0xffff) >>> 0)

export async function openModbusClient(ModbusRTU, endpoint, signal) {
  if (typeof ModbusRTU !== 'function') {
    const err = new Error('modbus-serial 不可用')
    err.code = 'IO_RUNTIME_UNAVAILABLE'
    throw err
  }
  const client = new ModbusRTU()
  client.isDebugEnabled = true
  const connectMs = IO_CONNECT_TIMEOUT_MS
  const timer = setTimeout(() => {
    try { client.close(() => {}) } catch { /* ignore */ }
  }, connectMs)
  try {
    if (endpoint.mode === 'tcp') {
      await client.connectTCP(endpoint.host, { port: endpoint.tcpPort })
    } else {
      await client.connectRTUBuffered(endpoint.port, {
        baudRate: endpoint.baudrate,
        dataBits: endpoint.bytesize,
        parity: rtuParityName(endpoint.parity),
        stopBits: endpoint.stopbits,
      })
    }
  } catch (error) {
    try { client.close(() => {}) } catch { /* ignore */ }
    const mapped = mapDriverError(error)
    const err = new Error(mapped.message)
    err.code = mapped.code === 'INVALID_RESPONSE' ? 'CONNECTION_TIMEOUT' : mapped.code
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (signal && signal.aborted) {
    try { client.close(() => {}) } catch { /* ignore */ }
    const err = new Error('已取消')
    err.code = 'CANCELLED'
    throw err
  }
  return client
}

export function closeModbusClient(client) {
  return new Promise((resolve) => {
    if (!client) {
      resolve()
      return
    }
    try {
      client.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

export async function runModbusOp(client, request, signal) {
  const started = process.hrtime.bigint()
  const unitId = Math.trunc(Number(request.unitId))
  const timeoutMs = clampTimeoutMs(request.timeoutMs, 1000)
  client.setID(unitId)
  client.setTimeout(timeoutMs)
  const fc = Math.trunc(Number(request.functionCode))
  const address = Math.trunc(Number(request.address))
  const abort = () => {
    try { client.close(() => {}) } catch { /* ignore */ }
  }
  if (signal) {
    if (signal.aborted) {
      const err = new Error('已取消')
      err.code = 'CANCELLED'
      throw err
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  let result
  try {
    if (request.op === 'modbus.read') {
      const count = Math.trunc(Number(request.count))
      if (fc === 1) result = await client.readCoils(address, count)
      else if (fc === 2) result = await client.readDiscreteInputs(address, count)
      else if (fc === 3) result = await client.readHoldingRegisters(address, count)
      else result = await client.readInputRegisters(address, count)
    } else if (fc === 5) {
      result = await client.writeCoil(address, request.values[0] === true || request.values[0] === 1)
    } else if (fc === 6) {
      result = await client.writeRegister(address, Number(request.values[0]) & 0xffff)
    } else if (fc === 15) {
      result = await client.writeCoils(address, asBools(request.values))
    } else {
      result = await client.writeRegisters(address, asRegs(request.values))
    }
  } catch (error) {
    const frames = extractDebugFrames(null, error)
    const mapped = mapDriverError(error)
    const err = new Error(mapped.message)
    Object.assign(err, mapped, { frames })
    throw err
  } finally {
    if (signal) signal.removeEventListener('abort', abort)
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6
  const data = request.op === 'modbus.read'
    ? ((fc === 1 || fc === 2) ? asBools(result && result.data).slice(0, Number(request.count)) : asRegs(result && result.data).slice(0, Number(request.count)))
    : (fc === 5 || fc === 6
      ? (fc === 5 ? [request.values[0] === true || request.values[0] === 1] : [Number(request.values[0]) & 0xffff])
      : request.values.length)
  const debug = extractDebugFrames(result, null)
  return {
    data,
    durationMs: Math.max(0, Math.round(durationMs)),
    frames: normalizeFrames(debug, request.endpoint && request.endpoint.mode),
  }
}
