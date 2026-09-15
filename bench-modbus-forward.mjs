// Compatibility facade — agent-stable surface; prefer src/application/modbus.
export {
  ERROR_CODES,
  buildEvidenceRefs,
  connectOp,
  listFrames,
  pickConnPatch as pickModbusPatch,
  pickConnPatch,
  pointsOp,
  modbusRead,
  modbusWrite,
  requestFocus,
} from './bench-modbus.mjs'
export { keilBuild, keilMap } from './bench-keil.mjs'
export { listDir } from './bench-listdir.mjs'
