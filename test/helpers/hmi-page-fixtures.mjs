// @ts-check
/**
 * Compatibility barrel for HMI page fixtures (P4-1).
 * Prefer importing from hmi-state / hmi-render / hmi-transport modules directly.
 */
export { MB, baseMb, t, makePost } from './hmi-state-fixtures.mjs'
export { selectConn, mountHmi } from './hmi-render-fixtures.mjs'
export {
  setupConnBench,
  fakeTransport,
  liveHarness,
  flagHarness,
  connection,
} from './hmi-transport-fixtures.mjs'
