#!/usr/bin/env node
/**
 * One-shot Stage 4 splitter: extract domain helpers + application services
 * from bench-modbus.mjs, then rewrite bench-modbus as a compatibility facade.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lines = readFileSync(join(root, 'bench-modbus.mjs'), 'utf8').split(/\n/)
const sl = (a, b) => lines.slice(a - 1, b).join('\n')

const ensure = (rel) => mkdirSync(join(root, rel), { recursive: true })
ensure('src/domain/modbus')
ensure('src/application/modbus')
ensure('src/infrastructure/modbus')

const write = (rel, body) => writeFileSync(join(root, rel), body.endsWith('\n') ? body : body + '\n')

write(
  'src/domain/modbus/errors.mjs',
  `/** Unified Modbus / Vision Bench error codes (HTTP + Agent share these). */
export const ERROR_CODES = {
  PORT_IN_USE: 'PORT_IN_USE',
  TARGET_REQUIRED: 'TARGET_REQUIRED',
  TARGET_MISMATCH: 'TARGET_MISMATCH',
  DEVICE_DISABLED: 'DEVICE_DISABLED',
  ENDPOINT_DRIFT: 'ENDPOINT_DRIFT',
  STALE_VALUE: 'STALE_VALUE',
  WRITE_READBACK_MISMATCH: 'WRITE_READBACK_MISMATCH',
  POINT_NOT_FOUND: 'POINT_NOT_FOUND',
  CONNECTION_NOT_FOUND: 'CONNECTION_NOT_FOUND',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  UNIT_ID_INVALID: 'UNIT_ID_INVALID',
  CONFIG_DRIFT: 'CONFIG_DRIFT',
  CONFLICT: 'CONFLICT',
  WRITE_OUTCOME_UNKNOWN: 'WRITE_OUTCOME_UNKNOWN',
  IO_RUNTIME_UNAVAILABLE: 'IO_RUNTIME_UNAVAILABLE',
}

export const fail = (errorCode, error, details = {}, retryable = false) => ({
  ok: false,
  errorCode,
  error,
  retryable,
  details,
})
`,
)

write(
  'src/domain/modbus/unit-id.mjs',
  `export const clampUnitId = (raw, { min = 0, max = 247 } = {}) => {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}

export const stampPoints = (pack) => (pack.points || []).map((p) => {
  const dev = (pack.devices || []).find((d) => d.id === p.deviceId)
  return { ...p, unitId: Math.min(247, Math.max(1, Math.trunc(Number(dev && dev.unitId) || 1))) }
})
`,
)

write(
  'src/domain/modbus/function-code.mjs',
  `import { pointIdOf } from '../../../bench-points.mjs'

export const AREA_FN = { coil: 1, discreteInput: 2, holdingRegister: 3, inputRegister: 4 }

export const fnOfPoint = (p) => Number(p && p.function) || AREA_FN[p && p.area] || 3

export const findPointV3 = (points, fn, address, activeConnId, activeDevId) => {
  const list = Array.isArray(points) ? points : []
  let hit = list.find(p => fnOfPoint(p) === Number(fn) && Number(p.address) === Number(address) && p.connectionId === activeConnId && p.deviceId === activeDevId)
  if (hit) return hit
  hit = list.find(p => fnOfPoint(p) === Number(fn) && Number(p.address) === Number(address))
  if (hit) return hit
  const id = pointIdOf(fn, address)
  return list.find(p => p.id === id) || null
}
`,
)

write(
  'src/domain/modbus/point-value.mjs',
  `export const STALE_MS = 30 * 1000

export const isStaleValue = (rec) => {
  if (!rec || rec.ok !== true) return false
  const at = Number(rec.at)
  if (!Number.isFinite(at) || at <= 0) return true
  return Date.now() - at > STALE_MS
}

${sl(198, 223).replace(/^const compactPointRow/, 'export const compactPointRow')}
`,
)

write(
  'src/domain/modbus/endpoint.mjs',
  `${sl(343, 370)
    .replace(/^const endpointFingerprint/, 'export const endpointFingerprint')
    .replace(/^const endpointLabelText/, 'export const endpointLabelText')
    .replace(/^const sameEndpoint/, 'export const sameEndpoint')}
`,
)

write(
  'src/domain/modbus/validation.mjs',
  `import { ERROR_CODES } from './errors.mjs'

${sl(70, 90)
  .replace(/^const deviceDisabledOf/, 'export const deviceDisabledOf')
  .replace(/^const targetRequired/, 'export const targetRequired')}

export const CONN_PATCH_KEYS = ['mode', 'port', 'baudrate', 'bytesize', 'parity', 'stopbits', 'host', 'tcpPort', 'sim']

export const pickConnPatch = (raw) => {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of CONN_PATCH_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out
}

${sl(461, 466).replace(/^const connReady/, 'export const connReady')}
`,
)

write(
  'src/domain/modbus/target-resolver.mjs',
  `// Agent target ambiguity helpers live beside validation for ADR clarity.
export { deviceDisabledOf, targetRequired } from './validation.mjs'
`,
)

write(
  'src/domain/modbus/model.mjs',
  `export { ERROR_CODES, fail } from './errors.mjs'
export { endpointFingerprint, endpointLabelText, sameEndpoint } from './endpoint.mjs'
export { clampUnitId, stampPoints } from './unit-id.mjs'
export { AREA_FN, fnOfPoint, findPointV3 } from './function-code.mjs'
export { STALE_MS, isStaleValue, compactPointRow } from './point-value.mjs'
export {
  deviceDisabledOf,
  targetRequired,
  CONN_PATCH_KEYS,
  pickConnPatch,
  connReady,
} from './validation.mjs'
`,
)

write('src/domain/modbus/index.mjs', `export * from './model.mjs'\n`)
write(
  'src/domain/index.mjs',
  `export * from './modbus/index.mjs'
export const DOMAIN_LAYER = 'domain'
`,
)

// Infrastructure adapters (thin re-exports of existing runtime ports)
write(
  'src/infrastructure/modbus/transport-adapter.mjs',
  `export {
  changedConnectionIds,
  createModbusTransport,
  notifyConnectionRelease,
  toReadRequest,
  toWriteRequest,
} from '../../../bench-modbus-transport.mjs'
`,
)

write(
  'src/infrastructure/modbus/io-broker-adapter.mjs',
  `export { createIoBroker } from '../../../bench-io-broker.mjs'
`,
)

// Shared application helpers + all ops in one migration module first,
// then re-exported through named service facades.
const sharedHeader = `import { pickArtifact } from '../../../bench-fs.mjs'
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import {
  clampInt,
  decodeValue,
  evaluateAlarm,
  evaluatePointAlarms,
  fillSimValues,
  functionTag,
  isWritableFunction,
  normalizePoints,
  normalizeWriteValues,
  pointIdOf,
  pointLabel,
  scatterBatch,
  setPointValue,
} from '../../../bench-points.mjs'
import { normalizeModbus, normalizePointV3 } from '../../../bench-devices.mjs'
import { evaluateAlarms, normalizeAlarmState } from '../../../bench-alarm.mjs'
import { planScopedReadBatches } from '../../../bench-pollplan.mjs'
import {
  changedConnectionIds,
  createModbusTransport,
  notifyConnectionRelease,
  toReadRequest,
  toWriteRequest,
} from '../../infrastructure/modbus/transport-adapter.mjs'
import { toEndpoint } from '../../../bench-io-contract.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from '../../../bench-modbus-commit.mjs'
import { aborted, hasRunning, originOf, signalOf } from '../../../bench-journal.mjs'
import {
  finishTask,
  loadWorkspace,
  normalizeFocusRequest,
  normalizeFocusState,
  openTask,
  pruneBuildLogs,
  recordBenchEvent,
  saveWorkspace,
} from '../../../bench-store.mjs'
import { portKey } from '../../../bench-portlock.mjs'
import { notifyBenchEvent } from '../../../bench-notify.mjs'
import { resolveTarget as resolveUnifiedTarget, TARGET_CODES } from '../../../bench-targets.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { endpointFingerprint, endpointLabelText, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { stampPoints } from '../../domain/modbus/unit-id.mjs'
import { fnOfPoint, findPointV3 } from '../../domain/modbus/function-code.mjs'
import { isStaleValue, compactPointRow } from '../../domain/modbus/point-value.mjs'
import { deviceDisabledOf, targetRequired, pickConnPatch, connReady } from '../../domain/modbus/validation.mjs'

export { ERROR_CODES, isStaleValue, pickConnPatch }

const transportOf = (opts) => (opts && opts.transport) || createModbusTransport()

const pollLocks = new Map()
const POLL_BUDGET_MS = 30000

const PENDING_TTL_MS = 5 * 60 * 1000
const pendingWrites = new Map()

`

// Body: from connectOp through end, minus domain pieces already extracted.
// Keep original helper implementations that remain application-local.
const bodyParts = [
  sl(121, 195), // connectOp
  sl(225, 336), // pointsOp (compactPointRow now imported)
  sl(372, 458), // pending write ops (endpoint helpers imported)
  sl(468, 556), // frames helpers + runReadTx
  sl(558, 1068), // modbusRead + pointBefore + modbusWrite start..entryLabel
  sl(1069, 1311), // entryLabel + polling + deviceAlarms
  `export const pickModbusPatch = pickConnPatch

`,
  sl(1316, 1479), // listFrames, requestFocus, buildEvidenceRefs
  `export const _internal = { deviceAlarms, evaluatePointAlarms, alarmLabel, endpointFingerprint }
`,
]

write('src/application/modbus/modbus-services.mjs', sharedHeader + bodyParts.join('\n') + '\n')

// Named service facades (plan layout)
const facade = (name, exportsList) =>
  `export {\n  ${exportsList.join(',\n  ')}\n} from './modbus-services.mjs'\n`

write('src/application/modbus/connection-service.mjs', facade('connection', ['connectOp', 'pickConnPatch', 'pickModbusPatch']))
write('src/application/modbus/point-service.mjs', facade('point', ['pointsOp']))
write('src/application/modbus/read-service.mjs', facade('read', ['modbusRead']))
write('src/application/modbus/write-service.mjs', facade('write', ['modbusWrite']))
write('src/application/modbus/polling-service.mjs', facade('poll', ['modbusPoll', 'migrateLegacyDisabled', 'deviceAlarms']))
write(
  'src/application/modbus/write-approval-service.mjs',
  facade('approval', ['createPendingWrite', 'popPendingWrite', 'listPendingWrites', 'resolvePendingWrite']),
)
write('src/application/modbus/frame-service.mjs', facade('frames', ['listFrames']))
write('src/application/modbus/focus-service.mjs', facade('focus', ['requestFocus']))
write('src/application/modbus/evidence-service.mjs', facade('evidence', ['buildEvidenceRefs']))

write(
  'src/application/modbus/index.mjs',
  `export { ERROR_CODES, isStaleValue, pickConnPatch, pickModbusPatch, _internal } from './modbus-services.mjs'
export { connectOp } from './connection-service.mjs'
export { pointsOp } from './point-service.mjs'
export { modbusRead } from './read-service.mjs'
export { modbusWrite } from './write-service.mjs'
export { modbusPoll, migrateLegacyDisabled, deviceAlarms } from './polling-service.mjs'
export {
  createPendingWrite,
  popPendingWrite,
  listPendingWrites,
  resolvePendingWrite,
} from './write-approval-service.mjs'
export { listFrames } from './frame-service.mjs'
export { requestFocus } from './focus-service.mjs'
export { buildEvidenceRefs } from './evidence-service.mjs'
`,
)

// Compatibility facade
write(
  'bench-modbus.mjs',
  `/** Compatibility facade — Modbus application services live under src/application/modbus. */
export {
  ERROR_CODES,
  isStaleValue,
  pickConnPatch,
  pickModbusPatch,
  connectOp,
  pointsOp,
  createPendingWrite,
  popPendingWrite,
  listPendingWrites,
  resolvePendingWrite,
  modbusRead,
  modbusWrite,
  migrateLegacyDisabled,
  modbusPoll,
  deviceAlarms,
  listFrames,
  requestFocus,
  buildEvidenceRefs,
  _internal,
} from './src/application/modbus/index.mjs'
`,
)

console.log('Stage 4 split written')
