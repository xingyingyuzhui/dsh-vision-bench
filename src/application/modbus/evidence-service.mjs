// @ts-check
import { evaluateAlarms, normalizeAlarmState } from '../../../bench-alarm.mjs'
import { normalizeModbus, normalizePointV3 } from '../../../bench-devices.mjs'
import { pickArtifact } from '../../../bench-fs.mjs'
import { toEndpoint } from '../../../bench-io-contract.mjs'
import { aborted, hasRunning, originOf, signalOf } from '../../../bench-journal.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from '../../../bench-modbus-commit.mjs'
import { notifyBenchEvent } from '../../../bench-notify.mjs'
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
import { planScopedReadBatches } from '../../../bench-pollplan.mjs'
import { portKey } from '../../../bench-portlock.mjs'
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
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from '../../../bench-targets.mjs'
import { endpointFingerprint, endpointLabelText, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3, fnOfPoint } from '../../domain/modbus/function-code.mjs'
import { compactPointRow, isStaleValue } from '../../domain/modbus/point-value.mjs'
import { stampPoints } from '../../domain/modbus/unit-id.mjs'
import { connReady, deviceDisabledOf, pickConnPatch, targetRequired } from '../../domain/modbus/validation.mjs'
import {
  changedConnectionIds,
  createModbusTransport,
  notifyConnectionRelease,
  toReadRequest,
  toWriteRequest,
} from '../../infrastructure/modbus/transport-adapter.mjs'
import {
  PENDING_TTL_MS,
  POLL_BUDGET_MS,
  alarmLabel,
  alarmSummary,
  createTransactionFrame,
  entryLabel,
  frameEntry,
  framesOf,
  pendingState,
  pendingWrites,
  pickModbusPatch,
  pointBefore,
  pointValuesOfBatch,
  pollLocks,
  prunePendingWrites,
  runReadTx,
  transportOf,
} from './modbus-runtime-context.mjs'
import { getSharedDebugRuntime } from '../debug/debug-runtime.mjs'

/** @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace */
/** @typedef {import('../../types/workspace.js').VisionWorkspace} VisionWorkspace */
/**
 * @param {string} home
 * @param {string} cwd
 */
export const buildEvidenceRefs = (home, cwd) => {
  const workspace = /** @type {VisionWorkspace} */ (loadWorkspace(home, cwd))
  const pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  const refs = []
  // compile evidence: latest build task
  const latestBuild = (workspace.tasks || []).find((t) => t.type === 'build')
  if (latestBuild)
    refs.push({
      kind: 'build',
      id: latestBuild.id,
      at: latestBuild.endedAt || latestBuild.startedAt,
      version: pack.configVersion || 1,
    })
  // log evidence: last timeline
  const lastLog = (workspace.timeline || [])[0]
  if (lastLog) refs.push({ kind: 'log', id: lastLog.id, at: lastLog.at, version: pack.configVersion || 1 })

  // debug snapshot evidence: latest snapshot if active
  try {
    const runtime = getSharedDebugRuntime()
    const activeSession = runtime.findSession((s) => s.workspaceCwd === cwd)
    const latestSnapshot = activeSession?.snapshots?.[activeSession.snapshots.length - 1]
    if (latestSnapshot) {
      refs.push({
        kind: 'debug_snapshot',
        id: latestSnapshot.id,
        snapshotId: latestSnapshot.id,
        debugSessionId: activeSession.debugSessionId,
        reason: latestSnapshot.reason,
        file: latestSnapshot.location?.file || '',
        line: latestSnapshot.location?.line || 0,
        firmwareHash: latestSnapshot.firmwareHash || '',
        at: latestSnapshot.createdAt || Date.now(),
        version: pack.configVersion || 1,
      })
    }
  } catch {}

  // point/frame/trend slices
  for (const p of pack.points.slice(0, 5))
    refs.push({
      kind: 'point',
      id: p.id,
      connectionId: p.connectionId,
      deviceId: p.deviceId,
      version: pack.configVersion || 1,
    })
  return refs
}
