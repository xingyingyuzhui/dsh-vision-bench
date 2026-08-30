export const IO_PROTOCOL_V = 1
export const IO_MAX_LINE = 64 * 1024
export const IO_HANDSHAKE_MS = 5000
export const IO_CONNECT_TIMEOUT_MS = 4000
export const IO_TIMEOUT_MIN_MS = 50
export const IO_TIMEOUT_MAX_MS = 30000
export const IO_RUNTIME_PACKAGES = {
  modbusSerial: '8.0.25',
  serialport: '13.0.0',
}

export const IO_OPS = new Set([
  'health',
  'modbus.read',
  'modbus.write',
  'connection.open',
  'connection.close',
  'connection.status',
  'serial.capture.feed',
  'release',
  'cancel',
  'shutdown',
])

export const IO_ERROR_CODES = {
  IO_RUNTIME_UNAVAILABLE: 'IO_RUNTIME_UNAVAILABLE',
  IO_RUNTIME_CRASHED: 'IO_RUNTIME_CRASHED',
  IO_BACKPRESSURE: 'IO_BACKPRESSURE',
  PORT_IN_USE: 'PORT_IN_USE',
  PORT_NOT_FOUND: 'PORT_NOT_FOUND',
  PORT_OPEN_FAILED: 'PORT_OPEN_FAILED',
  PORT_DISCONNECTED: 'PORT_DISCONNECTED',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  MODBUS_TIMEOUT: 'MODBUS_TIMEOUT',
  MODBUS_CRC_ERROR: 'MODBUS_CRC_ERROR',
  MODBUS_EXCEPTION: 'MODBUS_EXCEPTION',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  CANCELLED: 'CANCELLED',
  UNIT_ID_INVALID: 'UNIT_ID_INVALID',
  CONFIG_DRIFT: 'CONFIG_DRIFT',
  PROTOCOL_VIOLATION: 'PROTOCOL_VIOLATION',
}

const FC_READ = new Set([1, 2, 3, 4])
const FC_WRITE_SINGLE = new Set([5, 6])
const FC_WRITE_MULTI = new Set([15, 16])

export const clampTimeoutMs = (value, fallback = 1000) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(IO_TIMEOUT_MAX_MS, Math.max(IO_TIMEOUT_MIN_MS, Math.trunc(n)))
}

export const ioError = (code, message, extra = {}) => ({
  code: IO_ERROR_CODES[code] || String(code || 'IO_RUNTIME_UNAVAILABLE').slice(0, 48),
  message: String(message || code || 'I/O error').slice(0, 240),
  ...extra,
})

export const sanitizeIoError = (error) => {
  if (!error || typeof error !== 'object') return ioError('IO_RUNTIME_UNAVAILABLE', String(error || ''))
  return ioError(
    error.code,
    error.message,
    error.exceptionCode != null ? { exceptionCode: Number(error.exceptionCode) } : {},
  )
}

export const normalizeCom = (port) =>
  String(port || '')
    .replace(/^\\\\\.\\/, '')
    .trim()
    .toUpperCase()

export const toEndpoint = (connection) => {
  const conn = connection && connection.conn ? connection.conn : connection || {}
  const mode = conn.mode === 'tcp' ? 'tcp' : 'rtu'
  if (mode === 'tcp') {
    return {
      mode: 'tcp',
      host: String(conn.host || '').trim(),
      tcpPort: Math.min(65535, Math.max(1, Math.trunc(Number(conn.tcpPort) || 502))),
    }
  }
  const parityRaw = String(conn.parity || 'N')
    .toUpperCase()
    .slice(0, 1)
  const parity = parityRaw === 'E' || parityRaw === 'O' ? parityRaw : 'N'
  return {
    mode: 'rtu',
    port: normalizeCom(conn.port),
    baudrate: Math.trunc(Number(conn.baudrate) || 9600),
    bytesize: [7, 8].includes(Number(conn.bytesize)) ? Number(conn.bytesize) : 8,
    parity,
    stopbits: [1, 2].includes(Number(conn.stopbits)) ? Number(conn.stopbits) : 1,
  }
}

export const endpointFingerprint = (endpoint) => {
  const e = endpoint || {}
  if (e.mode === 'tcp') return ['tcp', String(e.host || ''), String(e.tcpPort || '')].join('|')
  return [
    'rtu',
    normalizeCom(e.port),
    String(e.baudrate || ''),
    String(e.bytesize || ''),
    String(e.parity || ''),
    String(e.stopbits || ''),
  ].join('|')
}

export const rtuParityName = (parity) => {
  if (parity === 'E') return 'even'
  if (parity === 'O') return 'odd'
  return 'none'
}

const validUnitId = (value) => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n >= 1 && n <= 247 ? n : 0
}

const hexOk = (value) => typeof value === 'string' && value.length % 2 === 0 && /^[0-9A-Fa-f]*$/.test(value)

export const normalizeFrames = (frames, mode) => {
  const src = frames && typeof frames === 'object' ? frames : {}
  const requestHex = hexOk(src.requestHex) ? String(src.requestHex).toUpperCase().slice(0, 400) : ''
  const responseHex = hexOk(src.responseHex) ? String(src.responseHex).toUpperCase().slice(0, 400) : ''
  return {
    requestHex,
    responseHex,
    frameFormat:
      src.frameFormat === 'tcp-normalized' || src.frameFormat === 'rtu-adu'
        ? src.frameFormat
        : mode === 'tcp'
          ? 'tcp-normalized'
          : 'rtu-adu',
  }
}

const rangeOk = (address, count, maxCount, coil) => {
  const addr = Math.trunc(Number(address))
  const n = Math.trunc(Number(count))
  if (!Number.isFinite(addr) || addr < 0 || addr > 65535) return false
  if (!Number.isFinite(n) || n < 1 || n > maxCount) return false
  if (addr + n - 1 > 65535) return false
  void coil
  return true
}

export const validateIoRequest = (msg) => {
  if (!msg || typeof msg !== 'object') return { ok: false, error: ioError('PROTOCOL_VIOLATION', '请求不是对象') }
  if (Number(msg.v) !== IO_PROTOCOL_V) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '协议版本必须是 1') }
  if (typeof msg.id !== 'string' || !msg.id || msg.id.length > 80) {
    return { ok: false, error: ioError('PROTOCOL_VIOLATION', '缺少请求 id') }
  }
  if (!IO_OPS.has(msg.op)) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '未知 op') }
  if (msg.op === 'health' || msg.op === 'shutdown' || msg.op === 'cancel') return { ok: true, request: msg }
  const cwd = String(msg.cwd || '')
  if (!cwd) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '缺少 cwd 或 connectionId') }
  if (msg.op === 'connection.status' || msg.op === 'serial.capture.feed') {
    return { ok: true, request: msg }
  }
  const connectionId = String(msg.connectionId || '')
  if (!connectionId) {
    return { ok: false, error: ioError('PROTOCOL_VIOLATION', '缺少 cwd 或 connectionId') }
  }
  if (msg.op === 'release' || msg.op === 'connection.close') {
    return { ok: true, request: msg }
  }
  if (msg.op === 'connection.open') {
    const endpoint = toEndpoint({ conn: msg.endpoint || msg })
    if (endpoint.mode === 'rtu' && !endpoint.port) return { ok: false, error: ioError('PORT_NOT_FOUND', '缺少串口') }
    if (endpoint.mode === 'tcp' && !endpoint.host)
      return { ok: false, error: ioError('PORT_NOT_FOUND', '缺少 TCP 主机') }
    return { ok: true, request: msg }
  }
  const deviceId = String(msg.deviceId || '')
  const unitId = validUnitId(msg.unitId)
  if (!deviceId) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '缺少 deviceId') }
  if (!unitId) return { ok: false, error: ioError('UNIT_ID_INVALID', 'Unit ID 必须是 1..247（不支持广播 0）') }
  const fc = Math.trunc(Number(msg.functionCode))
  const address = Math.trunc(Number(msg.address))
  if (msg.op === 'modbus.read') {
    if (!FC_READ.has(fc)) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '不支持的读功能码') }
    const max = fc === 1 || fc === 2 ? 2000 : 125
    if (!rangeOk(address, msg.count, max)) {
      return { ok: false, error: ioError('PROTOCOL_VIOLATION', '读地址或数量越界') }
    }
  }
  if (msg.op === 'modbus.write') {
    if (FC_WRITE_SINGLE.has(fc)) {
      if (!rangeOk(address, 1, 1)) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '写地址越界') }
    } else if (fc === 15) {
      if (!Array.isArray(msg.values) || !rangeOk(address, msg.values.length, 1968)) {
        return { ok: false, error: ioError('PROTOCOL_VIOLATION', '线圈批量写入数量越界') }
      }
    } else if (fc === 16) {
      if (!Array.isArray(msg.values) || !rangeOk(address, msg.values.length, 123)) {
        return { ok: false, error: ioError('PROTOCOL_VIOLATION', '寄存器批量写入数量越界') }
      }
    } else {
      return { ok: false, error: ioError('PROTOCOL_VIOLATION', '不支持的写功能码') }
    }
  }
  const endpoint = toEndpoint({ conn: msg.endpoint || {} })
  if (endpoint.mode === 'rtu' && !endpoint.port) return { ok: false, error: ioError('PORT_NOT_FOUND', '缺少串口') }
  if (endpoint.mode === 'tcp' && !endpoint.host) return { ok: false, error: ioError('PORT_NOT_FOUND', '缺少 TCP 主机') }
  return { ok: true, request: msg }
}

export const encodeNdjson = (obj) => JSON.stringify(obj) + '\n'

export const decodeNdjsonLine = (line) => {
  const raw = String(line || '')
  if (raw.length > IO_MAX_LINE) return { ok: false, error: ioError('PROTOCOL_VIOLATION', '报文超过 64 KiB') }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, error: ioError('PROTOCOL_VIOLATION', '报文不是 JSON') }
  }
}
