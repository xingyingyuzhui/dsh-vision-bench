// @ts-check
/**
 * Raw share-mutation fixtures for the review7 R1/R2 transaction suites.
 *
 * Fixtures are never built through `saveWorkspace` — its save-time
 * `validateCandidateDeviceLayers` would reject same-layer deviceId twins up
 * front — and they are wrapped as WORKSPACES (`current.modbus`), which is what
 * the real mutation callback receives.
 */
import { device, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

export const SHARE_OFF = { enabled: false, connections: false, points: false, visualization: false }
export const RAW_HOME = '/tmp/dvb-raw-share'
export const RAW_CWD = '/tmp/dvb-raw-share/board'

/** Deep copy for "input unchanged" assertions. */
export const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * Partitioned workspace whose current private layer owns raw twin d1 rows.
 * @param {string} [claimMarker]
 */
export function privateTwinD1(claimMarker = '') {
  return {
    modbus: {
      version: 3,
      share: { ...SHARE_OFF },
      connections: [rtuSim('c1', 'COM3')],
      devices: [],
      points: [],
      sessionConfigs: {
        s1: {
          connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
          devices: [device('d1', 'c1', 1), device('d1', 'c2', 2)],
          points: [],
        },
      },
      privateClaimSessionId: claimMarker,
      configVersion: 5,
    },
  }
}

/** Shared-effective workspace whose shared layer owns raw twin d1 rows (revoke candidate). */
export function sharedTwinD1() {
  return {
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: false, visualization: false },
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1), device('d1', 'c2', 2)],
      points: [],
      sessionConfigs: { s1: { connections: [], devices: [], points: [] } },
      privateClaimSessionId: 's1',
      configVersion: 7,
    },
  }
}
