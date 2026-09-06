import { normalizeModbus } from './bench-devices.mjs'
import { getVisionIoBroker } from './bench-io-broker.mjs'
import { clampTimeoutMs, endpointFingerprint, ioError, toEndpoint, validateIoRequest } from './bench-io-contract.mjs'

let simSeq = 0
const nextSimTx = () => 'sim:' + ++simSeq
let reqSeq = 0
const nextReqId = () => 'req-' + Date.now().toString(36) + '-' + ++reqSeq

const nowMs = () => {
  if (typeof performance !== 'undefined' && performance.now) return performance.now()
  return Number(process.hrtime.bigint()) / 1e6
}

export const toReadRequest = ({ cwd, connection, device, batch, timeoutMs, configVersion, source }) => {
  const endpoint = toEndpoint(connection)
  const unitId = Math.trunc(Number(device && device.unitId))
  return {
    v: 1,
    op: 'modbus.read',
    cwd,
    connectionId: connection && (connection.id || connection.connectionId),
    deviceId: device && device.id,
    endpoint,
    unitId,
    functionCode: Number(batch && batch.fc),
    address: Number(batch && batch.address),
    count: Number(batch && batch.count),
    timeoutMs: clampTimeoutMs(timeoutMs, 1000),
    configVersion: Number(configVersion) || 0,
    source: source === 'agent' ? 'agent' : source === 'polling' ? 'polling' : 'manual',
  }
}

export const toWriteRequest = ({ cwd, connection, device, point, values, timeoutMs, configVersion, fc, source }) => {
  const endpoint = toEndpoint(connection)
  const unitId = Math.trunc(Number(device && device.unitId))
  return {
    v: 1,
    op: 'modbus.write',
    cwd,
    connectionId: connection && (connection.id || connection.connectionId),
    deviceId: device && device.id,
    endpoint,
    unitId,
    functionCode: Number(fc || (point && point.function)),
    address: Number(point && point.address),
    values: Array.isArray(values) ? values : [values],
    timeoutMs: clampTimeoutMs(timeoutMs, 1000),
    configVersion: Number(configVersion) || 0,
    source: source === 'agent' ? 'agent' : source === 'polling' ? 'polling' : 'manual',
  }
}

const simRaw = (batch, fc = 3) => {
  const tick = Math.floor(Date.now() / 1000)
  return Array.from({ length: batch.count }, (_, i) => {
    const addr = Number(batch.address || 0) + i
    if (fc === 1 || fc === 2) {
      return (Math.floor(tick / 3) + addr) % 2 === 0 ? 1 : 0
    }
    return (addr * 10 + tick) & 0xffff
  })
}

export function changedConnectionIds(prevModbus, nextModbus) {
  const prev = normalizeModbus(prevModbus || {})
  const next = normalizeModbus(nextModbus || {})
  const ids = []
  for (const old of prev.connections || []) {
    const neu = (next.connections || []).find((item) => item.id === old.id)
    if (!neu) {
      ids.push(old.id)
      continue
    }
    if (neu.enabled === false && old.enabled !== false) {
      ids.push(old.id)
      continue
    }
    if (!!(neu.conn && neu.conn.sim) && !(old.conn && old.conn.sim)) {
      ids.push(old.id)
      continue
    }
    if (endpointFingerprint(toEndpoint(old)) !== endpointFingerprint(toEndpoint(neu))) ids.push(old.id)
  }
  return ids
}

export function notifyConnectionRelease(cwd, ids, extra = {}) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (!cwd || !list.length) return
  const transport = extra.transport || createModbusTransport()
  for (const id of list) {
    void transport.releaseConnection({ cwd, connectionId: id }).catch(() => {})
  }
}

export function createModbusTransport({ broker = getVisionIoBroker() } = {}) {
  const call = async (payload, opts) => {
    const body =
      payload && typeof payload === 'object' ? (payload.id ? payload : { ...payload, id: nextReqId() }) : payload
    const checked = validateIoRequest(body)
    if (!checked.ok) return { ok: false, error: checked.error }
    try {
      const ran = await broker.request(body, opts)
      if (ran && ran.ok === false) {
        return {
          ok: false,
          error: ran.error,
          frames: ran.frames,
          transactionId: ran.transactionId,
          durationMs: ran.durationMs,
        }
      }
      return ran
    } catch (error) {
      return {
        ok: false,
        error:
          error && error.code ? error : ioError('IO_RUNTIME_UNAVAILABLE', String((error && error.message) || error)),
        frames: error && error.frames,
        transactionId: error && error.transactionId,
        durationMs: error && error.durationMs,
      }
    }
  }

  return {
    toEndpoint,
    endpointFingerprint,
    toReadRequest,
    toWriteRequest,
    async health() {
      return broker.health()
    },
    async read(request, opts = {}) {
      if (opts.sim || request.endpoint?.sim) {
        const t0 = nowMs()
        const data = simRaw({ address: request.address, count: request.count }, request.functionCode)
        return {
          ok: true,
          data,
          durationMs: Math.max(0, Math.round(nowMs() - t0)),
          transactionId: nextSimTx(),
          frames: {
            requestHex: '',
            responseHex: '',
            frameFormat: request.endpoint && request.endpoint.mode === 'tcp' ? 'tcp-normalized' : 'rtu-adu',
            request: 'SIM TX ' + request.functionCode + '@' + request.address + '×' + request.count,
            response: 'SIM RX ' + data.slice(0, 3).join(','),
          },
        }
      }
      return call(request, opts)
    },
    async write(request, opts = {}) {
      if (opts.sim || request.endpoint?.sim) {
        const t0 = nowMs()
        return {
          ok: true,
          data: request.values,
          durationMs: Math.max(0, Math.round(nowMs() - t0)),
          transactionId: nextSimTx(),
          frames: {
            requestHex: '',
            responseHex: '',
            frameFormat: request.endpoint && request.endpoint.mode === 'tcp' ? 'tcp-normalized' : 'rtu-adu',
            request: 'SIM TX ' + request.functionCode + '@' + request.address,
            response: 'SIM RX ' + (Array.isArray(request.values) ? request.values.join(',') : ''),
          },
        }
      }
      return call(request, opts)
    },
    async openConnection(request, opts = {}) {
      return call({ v: 1, op: 'connection.open', ...request }, opts)
    },
    async closeConnection(request, opts = {}) {
      const state = broker && typeof broker.getState === 'function' ? broker.getState() : ''
      if (!state || state === 'idle' || state === 'stopped' || state === 'stopping') {
        return { ok: true, skipped: true, data: { state: 'disconnected' } }
      }
      return call({ v: 1, op: 'connection.close', cwd: request.cwd, connectionId: request.connectionId }, opts)
    },
    async listConnections(request, opts = {}) {
      const state = broker && typeof broker.getState === 'function' ? broker.getState() : ''
      if (!state || state === 'idle' || state === 'stopped') {
        return { ok: true, data: { connections: [] } }
      }
      return call({ v: 1, op: 'connection.status', cwd: request.cwd, connectionId: request.connectionId || '' }, opts)
    },
    async captureFeed(request, opts = {}) {
      const state = broker && typeof broker.getState === 'function' ? broker.getState() : ''
      if (!state || state === 'idle' || state === 'stopped') {
        return { ok: true, data: { open: false, lines: [], lastId: 0 } }
      }
      return call(
        {
          v: 1,
          op: 'serial.capture.feed',
          cwd: request.cwd,
          connectionId: request.connectionId || '',
          since: request.since,
          max: request.max,
        },
        opts,
      )
    },
    async releaseConnection(request, opts = {}) {
      return this.closeConnection(request, opts)
    },
    brokerState() {
      return broker && typeof broker.getState === 'function' ? broker.getState() : 'idle'
    },
    async stop() {
      if (broker && typeof broker.stop === 'function') await broker.stop()
    },
  }
}
