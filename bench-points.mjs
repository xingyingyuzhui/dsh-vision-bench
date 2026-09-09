// Compatibility facade: delegates Modbus points, values, and alarm evaluation to domain submodules.
// Maintains 100% backward compatibility for all existing callers and test suites.

export {
  pointIdOf,
  isWritableFunction,
  decodeValue,
} from './src/domain/modbus/point-math.mjs'

export {
  MAX_POINTS,
  MAX_VALUES,
  text,
  clampInt,
  clockOf,
  functionTag,
  functionCodeOf,
  writeTargetOf,
  normalizePoint,
  normalizePoints,
  pointLabel,
  findPoint,
  normalizeWriteValues,
  normalizeValueRec,
  setPointValue,
  scatterBatch,
  fillSimValues,
  encodeValue,
  pointRuntimeStatus,
} from './src/domain/modbus/point-model.mjs'

export {
  pointsToCsv,
  csvToPoints,
} from './src/domain/modbus/point-csv.mjs'

export {
  evaluateAlarm,
  evaluatePointAlarms,
  alarmLabelText,
} from './src/domain/modbus/point-alarm.mjs'

export {
  MAX_SEGMENTS,
  MAX_COUNT,
  newSegmentId,
  defaultSegmentName,
  pointName,
  pointKey,
  normalizeSegment,
  normalizeSegments,
  normalizeValue,
  normalizeValues,
  sameRange,
  addSegment,
  removeSegment,
  expandPoints,
  applySegmentRead,
  segmentCovering,
  applyPointWrite,
  compactSegments,
  compactValues,
  simulateRaw,
  simulateSegmentRan,
  segmentsToCsv,
  csvToSegments,
} from './src/domain/modbus/point-legacy-segments.mjs'
