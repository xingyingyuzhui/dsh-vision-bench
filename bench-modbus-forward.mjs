// Stable import surface for the agent tool while the actions module keeps its
// forwarding role.
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
