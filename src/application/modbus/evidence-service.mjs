// @ts-check
import { evaluateAlarms, normalizeAlarmState } from '../../domain/modbus/alarm-model.mjs'
import { normalizeModbus } from './modbus-migration.mjs'
import { normalizePointV3 } from '../../domain/modbus/point-model.mjs'
import { pickArtifact } from '../../infrastructure/files/project-fs.mjs'
import { toEndpoint } from '../../domain/modbus/io-contract.mjs'
import { aborted, hasRunning, originOf, signalOf } from '../../domain/modbus/journal-model.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from './modbus-commit.mjs'
import { notifyBenchEvent } from '../../infrastructure/host/notify.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { clampInt, fillSimValues, functionTag, normalizePoints, normalizeWriteValues, pointLabel, scatterBatch, setPointValue } from '../../domain/modbus/point-model.mjs'
import { decodeValue, isWritableFunction, pointIdOf } from '../../domain/modbus/point-math.mjs'
import { evaluateAlarm, evaluatePointAlarms } from '../../domain/modbus/point-alarm.mjs'
import { planScopedReadBatches } from '../../domain/modbus/poll-plan.mjs'
import { portKey } from '../../infrastructure/modbus/port-lock.mjs'
import { finishTask, openTask, pruneBuildLogs, recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { loadWorkspace, saveWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeFocusRequest, normalizeFocusState } from '../../infrastructure/store/focus-store.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from './target-resolver-service.mjs'
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
