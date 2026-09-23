// @ts-check
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import { normalizePointV3 } from '../../domain/modbus/point-model.mjs'
import { pickArtifact } from '../../infrastructure/files/project-fs.mjs'
import { toEndpoint } from '../../domain/modbus/io-contract.mjs'
import { aborted, hasRunning, originOf, signalOf } from '../../domain/modbus/journal-model.mjs'
import { commitPollResult, commitReadResult, commitWriteResult } from './modbus-commit.mjs'
import { emitCommittedAlarmTransitions } from './poll-alarm-notify.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import {
  clampInt,
  fillSimValues,
  functionTag,
  normalizePoints,
  normalizeWriteValues,
  pointLabel,
  scatterBatch,
  setPointValue,
} from '../../domain/modbus/point-model.mjs'
import { decodeValue, isWritableFunction, pointIdOf } from '../../domain/modbus/point-math.mjs'
import { evaluateAlarm, evaluatePointAlarms } from '../../domain/modbus/point-alarm.mjs'
import { planScopedReadBatches } from '../../domain/modbus/poll-plan.mjs'
import { portKey } from '../../infrastructure/modbus/port-lock.mjs'
import { finishTask, openTask, pruneBuildLogs, recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { loadWorkspace, saveWorkspaceAsync } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeFocusRequest, normalizeFocusState } from '../../infrastructure/store/focus-store.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from '../../domain/modbus/target-resolver-service.mjs'
import { endpointFingerprint, endpointLabelText, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3, fnOfPoint } from '../../domain/modbus/function-code.mjs'
import { compactPointRow, isStaleValue } from '../../domain/modbus/point-value.mjs'
import { stampPoints } from '../../domain/modbus/unit-id.mjs'
import { resolvePollSessionOwnership, resolvePollTargets } from './poll-session-ownership.mjs'
import { validatePollRuntimeIdentities } from './poll-runtime-identity.mjs'
import {
  preparePollReadPlan,
  prepareReadTargets,
  prepareTargetViews,
} from './poll-target-preparation.mjs'
export { resolvePollSessionOwnership, resolvePollTargets }
import {
  isScopePartitioned,
  normalizeSessionConfigs,
  unionScopedConnections,
  unionScopedDevices,
  unionScopedPoints,
} from '../../domain/modbus/config-scope.mjs'
import { modbusForSession } from './workspace-session-view.mjs'
import { connReady, deviceDisabledOf, pickConnPatch, targetRequired } from '../../domain/modbus/validation.mjs'
import {
  changedConnectionIds,
  createModbusTransport,
  notifyConnectionRelease,
  toReadRequest,
  toWriteRequest,
} from '../../infrastructure/modbus/transport-adapter.mjs'
export { deviceAlarms } from './modbus-runtime-context.mjs'
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
  pointValuesOfBatch,
  pollLocks,
  prunePendingWrites,
  runReadTx,
  transportOf,
} from './modbus-runtime-context.mjs'
/**
 * @typedef {import('../../types/modbus.js').ModbusOperationOptions} ModbusOperationOptions
 * @typedef {import('../../types/modbus.js').ModbusWorkspace} ModbusWorkspace
 */
/**
 * @param {string} home
 * @param {string} cwd
 */
export const migrateLegacyDisabled = async (home, cwd) => {
  const workspace = loadWorkspace(home, cwd)
  const pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus || {}))
  const disabledConnIds = (pack.connections || []).filter((/** @type {any} */ c) => c.enabled === false).map((/** @type {any} */ c) => c.id)
  const hasDisabledDevice = (pack.devices || []).some((/** @type {any} */ d) => d.enabled === false)
  if (!disabledConnIds.length && !hasDisabledDevice) return { ok: true, migrated: false }
  const nextPolling = { ...(pack.pollingByConnection || {}) }
  for (const cid of disabledConnIds) {
    const cur = nextPolling[cid] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
    nextPolling[cid] = { ...cur, enabled: false } // 停止自动采集
  }
  const connections = (pack.connections || []).map((/** @type {any} */ c) =>
    disabledConnIds.includes(c.id) ? { ...c, enabled: true } : c,
  )
  const devices = (pack.devices || []).map((/** @type {any} */ d) => (d.enabled === false ? { ...d, enabled: true } : d))
  await saveWorkspaceAsync(home, cwd, {
    modbus: {
      connections,
      devices,
      pollingByConnection: nextPolling,
      version: 3,
    },
  })
  return { ok: true, migrated: true, stopped: disabledConnIds }
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusOperationOptions} opts
 */
export const modbusPoll = async (home, cwd, opts) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const workspace = loadWorkspace(home, room.cwd)
  const cidArg = opts && (opts.connectionId || opts.connId) ? String(opts.connectionId || opts.connId).trim() : ''
  const sessionId = String(opts?.sessionId || '')
  // Full batch ownership pre-check BEFORE any transport / frames / runtime commit.
  const batchOwnership = resolvePollTargets(workspace, { sessionId, connectionId: cidArg })
  if (!batchOwnership.ok) {
    return {
      ok: false,
      skipped: true,
      error: batchOwnership.error,
      errorCode: batchOwnership.errorCode,
      reason: batchOwnership.reason,
      conflicts: batchOwnership.conflicts,
      owners: batchOwnership.conflicts[0]?.owners,
      polling: workspace.modbus?.polling,
      pollingByConnection: workspace.modbus?.pollingByConnection,
      values: workspace.modbus?.values,
    }
  }
  /** @type {Record<string, string>} */
  const sourceSessionByConnection = {}
  for (const t of batchOwnership.targets) {
    sourceSessionByConnection[t.connectionId] = t.sourceSessionId
  }
  const targetSessionId = sessionId || batchOwnership.targets[0]?.sourceSessionId || ''


  /** @type {ModbusWorkspace} */
  // Workspace-level runtime (values/polling/frames) — never substitute the first
  // session pack for the whole batch.
  const workspaceRuntimePack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  let pack = workspaceRuntimePack

  const preparedTargets = prepareTargetViews(workspace, batchOwnership.targets)
  const executable = prepareReadTargets(preparedTargets)
  const targetConns = executable.map((t) => t.connObj)
  if (cidArg && !targetConns.length) {
    const requested = preparedTargets.find((t) => t.connectionId === cidArg)
    return {
      ok: false,
      error: requested?.connection && requested.connection.enabled === false ? '设备已禁用' : `连接不存在: ${cidArg}`,
    }
  }
  if (!targetConns.length) return { ok: false, error: '无可用连接' }
  const readTargets = executable.map((t) => ({
    connectionId: t.connectionId,
    sourceSessionId: t.sourceSessionId,
    points: t.points,
  }))
  const batchHasPoints = readTargets.some((t) => t.points.length > 0)
  if (!batchHasPoints) return { ok: false, error: '无点位，请先添加点位' }
  const plan = preparePollReadPlan(executable)
  if (!plan.ok) {
    return {
      ok: false,
      skipped: true,
      error: plan.error,
      errorCode: plan.errorCode,
      reason: plan.reason,
      conflicts: plan.conflicts,
      polling: workspace.modbus?.polling,
      pollingByConnection: workspace.modbus?.pollingByConnection,
      values: workspace.modbus?.values,
    }
  }
  // Runtime pointId identity conflicts must be rejected BEFORE transport/commit.
  const identityCheck = validatePollRuntimeIdentities(workspace, readTargets)
  if (!identityCheck.ok) {
    return {
      ok: false,
      skipped: true,
      error: identityCheck.error,
      errorCode: identityCheck.errorCode,
      reason: identityCheck.reason,
      conflicts: identityCheck.conflicts,
      polling: workspace.modbus?.polling,
      pollingByConnection: workspace.modbus?.pollingByConnection,
      values: workspace.modbus?.values,
    }
  }
  if (hasRunning(workspace, 'read')) {
    return {
      ok: true,
      skipped: true,
      polling: pack.polling,
      pollingByConnection: pack.pollingByConnection,
      values: pack.values,
    }
  }
  // use a global lock per cwd (legacy) plus per-conn locks for multi
  const lockKey = room.cwd + (cidArg ? `:${cidArg}` : '')
  if (pollLocks.has(lockKey) || pollLocks.has(room.cwd)) {
    return {
      ok: true,
      skipped: true,
      busy: true,
      polling: pack.polling,
      pollingByConnection: pack.pollingByConnection,
      values: pack.values,
    }
  }
  const outer = signalOf(null, opts)
  const budgetMs = Number(opts?.budgetMs)
  const budget = AbortSignal.timeout(Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : POLL_BUDGET_MS)
  const signal = outer ? AbortSignal.any([outer, budget]) : budget
  pollLocks.set(lockKey, true)
  // also set global for legacy callers if not per-conn
  if (!cidArg) pollLocks.set(room.cwd, true)
  let ok = true
  let timedOut = false
  try {
    let values = pack.values
    /** @type {Map<string, any>} */
    const changedById = new Map()
    const framesLog = []
    /** @type {Record<string, { lastAt: number, lastOk: boolean, error: string }>} */
    const pollingRuntime = {}
    for (const connObj of targetConns) {
      const conn = connObj.conn
      const connId = connObj.id
      const tpack = connObj.__pack || pack
      const pts = Array.isArray(connObj.__points)
        ? connObj.__points
        : tpack.points.filter((/** @type {any} */ p) => (p.connectionId || p.connId) === connId)
      if (!pts.length) {
        pollingRuntime[connId] = {
          lastAt: Date.now(),
          lastOk: true,
          error: '',
        }
        continue
      }
      const transport = transportOf(opts)
      let connOk = true
      const planned = (plan.targets || []).find(
        (t) => t.connectionId === connId && (t.sourceSessionId || '') === (connObj.__sourceSessionId || ''),
      )
      const scopes = planned?.scopes || []
      for (const scope of scopes) {
        const batchConnObj = scope.connection || connObj
        const batchDevice = scope.device
        for (const batch of scope.batches) {
          if (aborted(signal)) {
            timedOut = true
            ok = false
            connOk = false
            break
          }
          // Budget only skips remaining batches. Passing it into I/O would abort
          // the in-flight read and close the COM (runModbusOp abort → client.close).
          const ran = await runReadTx(
            transport,
            tpack,
            batchConnObj,
            batchDevice,
            batch,
            room.cwd,
            4000,
            outer,
            'polling',
          )
          if (ran.cancelled || aborted(signal)) {
            timedOut = true
            ok = false
            connOk = false
            break
          }
          if (!ran.ok) {
            ok = false
            connOk = false
          }
          const raw =
            ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw)
              ? ran.result.details.raw
              : []
          // Scope scatter to this device/connection's points only — never pack.points.
          values = scatterBatch(values, scope.points, batch, raw, !!ran.ok, ran.ok ? '' : ran.error || '')
          for (const rec of pointValuesOfBatch(values, { points: scope.points }, batch)) {
            const id = rec && (rec.pointId || rec.key)
            if (id) changedById.set(id, rec)
          }
          const f = ran.frames || framesOf(ran)
          const entry = f
            ? createTransactionFrame(`读 ${functionTag(batch.fc)}${batch.address}×${batch.count}（监视）`, f, {
                connectionId: scope.connectionId || connId,
                deviceId: scope.deviceId,
                unitId: scope.unitId,
                functionCode: batch.fc,
                durationMs: ran.durationMs || 0,
                transactionId: ran.transactionId,
                status: ran.ok ? 'ok' : 'error',
                error: ran.ok ? '' : ran.error || '',
                source: 'polling',
                port: batchConnObj?.conn?.port || '',
                at: Date.now(),
              })
            : null
          if (entry) framesLog.push(entry)
          // Persist once per poll tick (below), not once per Modbus batch —
          // sparse point maps otherwise rewrite runtime.json hundreds of times.
        }
        if (!connOk) break
      }
      pollingRuntime[connId] = {
        lastAt: Date.now(),
        lastOk: connOk && !timedOut,
        error: timedOut ? '轮询超时' : connOk ? '' : '轮询部分失败',
      }
    }
    const changedPointValues = [...changedById.values()]
    // One runtime persist per tick: only touched point values + real frames +
    // polled connection stamps. Alarm transitions come back from the commit so
    // journal/notify cannot disagree with what landed on disk.
    const committed = await commitPollResult(home, room.cwd, {
      baseConfigVersion: pack.configVersion,
      pointValues: changedPointValues,
      frames: framesLog,
      pollingRuntime,
    })
    if (!committed?.ok) {
      return {
        ok: false,
        skipped: false,
        partial: timedOut,
        timedOut,
        values: pack.values,
        polling: pack.pollingByConnection?.[pack.activeConnectionId || ''] ||
          pack.pollingByConnection?.[targetConns[0]?.id || ''] ||
          pack.polling,
        pollingByConnection: pack.pollingByConnection,
        framesLog,
        framesByConnection: pack.framesByConnection,
        error: committed?.error || '轮询提交失败',
      }
    }
    if (!committed.drift) {
      await emitCommittedAlarmTransitions(home, room.cwd, committed.alarms, {
        sourceSessionId: targetSessionId || undefined,
        sourceSessionByConnection,
      })
    }
    const nextMb = committed.workspace.modbus
    return {
      ok,
      skipped: false,
      partial: timedOut,
      timedOut,
      values: nextMb.values,
      polling: nextMb.pollingByConnection?.[pack.activeConnectionId || ''] ||
        nextMb.pollingByConnection?.[targetConns[0]?.id || ''] ||
        nextMb.polling,
      pollingByConnection: nextMb.pollingByConnection,
      framesLog,
      framesByConnection: nextMb.framesByConnection,
      error: ok ? undefined : timedOut ? '轮询超时' : '',
    }
  } finally {
    pollLocks.delete(lockKey)
    if (!cidArg) pollLocks.delete(room.cwd)
  }
}
