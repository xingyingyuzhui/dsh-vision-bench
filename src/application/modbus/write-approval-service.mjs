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
/** @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody */
/**
 * @param {string} cwd
 * @param {ModbusCommandBody} params
 * @returns {ModbusCommandBody & { id: string }}
 */
export const createPendingWrite = (cwd, params) => {
  const id = `pw${Date.now().toString(36)}${(++pendingState.seq).toString(36)}`
  pendingWrites.set(`${cwd}:${id}`, { id, cwd, createdAt: Date.now(), params })
  prunePendingWrites()
  return { id, ...params }
}

/** @param {string} cwd @param {string} id */
export const popPendingWrite = (cwd, id) => {
  prunePendingWrites()
  const key = `${String(cwd)}:${String(id || '')}`
  const entry = pendingWrites.get(key)
  if (!entry) return null
  pendingWrites.delete(key)
  return entry
}

/** @param {string} cwd */
export const listPendingWrites = (cwd) => {
  prunePendingWrites()
  const out = []
  for (const entry of pendingWrites.values()) {
    if (entry.cwd === cwd) out.push({ id: entry.id, ...entry.params })
  }
  return out
}
