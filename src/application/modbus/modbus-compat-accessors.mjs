// @ts-check
import { emptyConn } from '../../domain/modbus/connection-model.mjs'
import { normalizePolling } from '../../domain/modbus/frames-buffer.mjs'

/**
 * Attach non-enumerable legacy v2-compat getters onto a normalized v3 pack.
 * @param {any} ret
 * @param {{ includeExtended?: boolean }} [opts]
 */
export function attachLegacyCompatAccessors(ret, opts = {}) {
  const includeExtended = opts.includeExtended === true
  /** @type {PropertyDescriptorMap} */
  const descriptors = {
    conn: {
      get() {
        const ac =
          ret.connections.find((/** @type {any} */ c) => c.id === ret.activeConnectionId) || ret.connections[0]
        return ac ? ac.conn : emptyConn()
      },
      enumerable: false,
    },
    mode: {
      get() {
        return ret.conn.mode
      },
      enumerable: false,
    },
    port: {
      get() {
        return ret.conn.port
      },
      enumerable: false,
    },
    host: {
      get() {
        return ret.conn.host
      },
      enumerable: false,
    },
    baudrate: {
      get() {
        return ret.conn.baudrate
      },
      enumerable: false,
    },
    slave: {
      get() {
        const ad = ret.devices.find(
          (/** @type {any} */ d) => d.id === ret.activeDeviceId && d.connectionId === ret.activeConnectionId,
        )
        return ad ? ad.unitId : 1
      },
      enumerable: false,
    },
    sim: {
      get() {
        return ret.conn.sim
      },
      enumerable: false,
    },
    polling: {
      get() {
        return ret.pollingByConnection[ret.activeConnectionId] || normalizePolling(null)
      },
      enumerable: false,
    },
    alarmActive: {
      get() {
        return ret.alarmState
      },
      enumerable: false,
    },
    function: {
      get() {
        return ret.points[0]?.function
      },
      enumerable: false,
    },
    address: {
      get() {
        return ret.points[0]?.address
      },
      enumerable: false,
    },
    segments: {
      get() {
        return ret.points.map((/** @type {any} */ p) => ({ ...p, count: 1, id: p.id }))
      },
      enumerable: false,
    },
  }
  if (includeExtended) {
    descriptors.pointsLegacy = {
      get() {
        return ret.points
      },
      enumerable: false,
    }
    descriptors.devices_legacy = {
      get() {
        return ret.devices
      },
      enumerable: false,
    }
  }
  Object.defineProperties(ret, descriptors)
  return ret
}
