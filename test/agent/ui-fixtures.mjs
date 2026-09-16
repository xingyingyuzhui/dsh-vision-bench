// @ts-check
/** Shared arrange for agent UI / tool-surface suites. */
import { connection } from '../helpers/workspace-factory.mjs'

/** RTU connection row for agent targeting tests. */
export function agentRtu(id, port, { enabled = true, name, sim = true, ...connExtra } = {}) {
  return {
    ...connection(id, 'rtu', port, { sim, ...connExtra }),
    name: name || id,
    enabled,
  }
}

/** TCP connection row (non-sim) for protocol outcome tests. */
export function agentTcp(id, { host = '10.0.0.8', tcpPort = 502, slave = 1, name } = {}) {
  return {
    id,
    name: name || id,
    role: 'client',
    enabled: true,
    conn: { mode: 'tcp', host, tcpPort, slave },
  }
}

export function agentDevice(id, connectionId, unitId = 1, name) {
  return { id, connectionId, name: name || id.toUpperCase(), unitId }
}

export function agentHrPoint(id, connectionId, deviceId, address, extras = {}) {
  return {
    id,
    connectionId,
    deviceId,
    name: extras.name || id,
    area: 'holdingRegister',
    function: 3,
    address,
    ...extras,
  }
}

/** Fake transport with matching write/readback values. */
export function matchingReadbackTransport(value = 7) {
  return {
    write: async () => ({
      ok: true,
      data: [value],
      transactionId: 'fake-w',
      durationMs: 1,
      frames: {
        request: 'TX 06',
        response: 'RX 06',
        requestHex: '010600000007',
        responseHex: '010600000007',
        frameFormat: 'tcp-normalized',
      },
    }),
    read: async () => ({
      ok: true,
      data: [value],
      transactionId: 'fake-r',
      durationMs: 1,
      frames: {
        request: 'TX 03',
        response: 'RX 03',
        requestHex: '010300000001',
        responseHex: '0103020007',
        frameFormat: 'tcp-normalized',
      },
    }),
  }
}

/** Write times out; readback must not run. */
export function writeTimeoutTransport() {
  return {
    write: async () => ({
      ok: false,
      error: { code: 'MODBUS_TIMEOUT', message: 'I/O 超时' },
      transactionId: 'tx-timeout',
      frames: { requestHex: '0106', responseHex: '', frameFormat: 'tcp-normalized' },
    }),
    read: async () => {
      throw new Error('must not readback after unknown write')
    },
  }
}
