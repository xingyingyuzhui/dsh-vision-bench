// Compatibility facade — prefer src application modules.
export { keilScan, keilTargets, keilMap } from './src/application/keil/project-service.mjs'
export { keilBuild } from './src/application/keil/build-service.mjs'
export { FLASH_INTERFACES, FLASH_TARGETS, openocdDownload } from './src/application/flash/flash-service.mjs'
export {
  ERROR_CODES,
  buildEvidenceRefs,
  connectOp,
  createPendingWrite,
  listFrames,
  listPendingWrites,
  modbusPoll,
  modbusRead,
  modbusWrite,
  pickConnPatch,
  pointsOp,
  peekPendingWrite,
  requestFocus,
  resolvePendingWrite,
  takePendingWrite,
  _internal,
} from './src/application/modbus/index.mjs'
import { listWorkspaceDir } from './src/infrastructure/files/project-fs.mjs'
export const listDir = (cwd, path) => listWorkspaceDir(cwd, path)
