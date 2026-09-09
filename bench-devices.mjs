// Compatibility facade: delegates Modbus device & connection modeling to dedicated submodules.
// Maintains 100% backward compatibility for all existing callers and test suites.

export {
  emptyConn,
  normalizeConn,
  connLabel,
  emptyConnection,
  normalizeConnection,
  normalizeConnections,
  validateConnections,
} from './src/domain/modbus/connection-model.mjs'

export {
  parseUnitId,
  emptyDevice,
  normalizeDevice,
  normalizeDevices,
  validateDevices,
  addDevice,
  removeDevice,
  patchActiveDevice,
} from './src/domain/modbus/device-model.mjs'

export {
  normalizeFramesByConnection,
  normalizePollingByConnection,
  normalizeTrendByPoint,
} from './src/domain/modbus/frames-buffer.mjs'

export {
  normalizePointV3,
  normalizePointsV3,
} from './src/domain/modbus/point-model.mjs'

export {
  normalizeConfigVersion,
  normalizeModbus,
  patchConn,
  recipePair,
} from './src/application/modbus/modbus-migration.mjs'
