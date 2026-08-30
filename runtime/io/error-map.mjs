import { ioError } from '../../bench-io-contract.mjs'

const CRC_RE = /crc/i
const TIMEOUT_RE = /timed?\s*out|timeout/i
const ENOENT_RE = /ENOENT|cannot find|not found|no such file/i
const IN_USE_RE = /EADDRINUSE|access denied|busy|in use|EACCES|EBUSY/i
const DISCONNECT_RE = /ECONNRESET|EPIPE|disconnected|socket hang up/i

export const mapDriverError = (error) => {
  if (!error) return ioError('INVALID_RESPONSE', '未知错误')
  if (
    (error.code && String(error.code).startsWith('IO_')) ||
    [
      'PORT_IN_USE',
      'PORT_NOT_FOUND',
      'PORT_OPEN_FAILED',
      'PORT_DISCONNECTED',
      'CONNECTION_TIMEOUT',
      'MODBUS_TIMEOUT',
      'MODBUS_CRC_ERROR',
      'MODBUS_EXCEPTION',
      'INVALID_RESPONSE',
      'CANCELLED',
      'UNIT_ID_INVALID',
      'CONFIG_DRIFT',
    ].includes(error.code)
  ) {
    return ioError(error.code, error.message, error.exceptionCode != null ? { exceptionCode: error.exceptionCode } : {})
  }
  const name = String(error.name || '')
  const code = String(error.code || error.errno || '')
  const message = String(error.message || error)
  const exceptionCode = error.modbusCode ?? error.exceptionCode ?? error.modbusExceptionCode
  if (exceptionCode != null && Number.isFinite(Number(exceptionCode))) {
    return ioError('MODBUS_EXCEPTION', 'Modbus 异常 ' + Number(exceptionCode), { exceptionCode: Number(exceptionCode) })
  }
  if (name === 'AbortError' || code === 'ABORT_ERR' || error.cancelled) {
    return ioError('CANCELLED', '已取消')
  }
  if (CRC_RE.test(message) || CRC_RE.test(name)) return ioError('MODBUS_CRC_ERROR', 'CRC 校验失败')
  if (TIMEOUT_RE.test(message) || TIMEOUT_RE.test(name) || code === 'ETIMEDOUT') {
    return ioError('MODBUS_TIMEOUT', 'Modbus 响应超时')
  }
  if (code === 'ENOENT' || ENOENT_RE.test(message)) return ioError('PORT_NOT_FOUND', '串口不存在')
  if (IN_USE_RE.test(message) || code === 'EACCES' || code === 'EBUSY' || code === 'EADDRINUSE') {
    return ioError('PORT_IN_USE', '串口被占用')
  }
  if (DISCONNECT_RE.test(message) || code === 'ECONNRESET' || code === 'EPIPE') {
    return ioError('PORT_DISCONNECTED', '连接断开')
  }
  if (code === 'ECONNREFUSED' || /refused/i.test(message)) {
    return ioError('CONNECTION_TIMEOUT', '无法连接从站')
  }
  return ioError('INVALID_RESPONSE', message.slice(0, 240))
}

export const buffersToHex = (value) => {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const parts = []
  for (const item of list) {
    if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
      parts.push(Buffer.from(item).toString('hex'))
    } else if (item && item.buffer && (Buffer.isBuffer(item.buffer) || item.buffer instanceof ArrayBuffer)) {
      const view =
        item.byteLength != null
          ? Buffer.from(item.buffer, item.byteOffset || 0, item.byteLength)
          : Buffer.from(item.buffer)
      parts.push(view.toString('hex'))
    } else if (typeof item === 'string' && /^[0-9A-Fa-f]+$/.test(item.replace(/\s/g, ''))) {
      parts.push(item.replace(/\s/g, ''))
    }
  }
  return parts.join('').toUpperCase().slice(0, 400)
}

export const extractDebugFrames = (result, error) => {
  const src = result || error || {}
  const request = src.request || src.modbusRequest || (error && (error.modbusRequest || error.request))
  const responses = src.responses || src.modbusResponses || (error && (error.modbusResponses || error.responses))
  return {
    requestHex: buffersToHex(request),
    responseHex: buffersToHex(responses),
  }
}
