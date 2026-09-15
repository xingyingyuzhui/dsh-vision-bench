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
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from './target-resolver-service.mjs'
import { endpointFingerprint, endpointLabelText, sameEndpoint } from '../../domain/modbus/endpoint.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { findPointV3, fnOfPoint } from '../../domain/modbus/function-code.mjs'
import { compactPointRow, isStaleValue } from '../../domain/modbus/point-value.mjs'
import { stampPoints } from '../../domain/modbus/unit-id.mjs'
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
  pointBefore,
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
  let targetSessionId = sessionId
  const scMap = workspace.modbus?.sessionConfigs || {}
  if (!targetSessionId && cidArg) {
    targetSessionId =
      Object.keys(scMap).find((/** @type {any} */ sid) => scMap[sid]?.connections?.some((/** @type {any} */ c) => c && c.id === cidArg)) ||
      ''
  }
  if (!targetSessionId && workspace.session?.boundId && scMap[workspace.session.boundId]) {
    targetSessionId = workspace.session.boundId
  }

  /** @type {ModbusWorkspace} */
  let pack
  if (targetSessionId) {
    pack = /** @type {ModbusWorkspace} */ (modbusForSession(workspace, targetSessionId))
  } else if (isScopePartitioned(workspace.modbus)) {
    const sc = normalizeSessionConfigs(scMap)
    pack = /** @type {ModbusWorkspace} */ (
      normalizeModbus({
        ...workspace.modbus,
        connections: unionScopedConnections(workspace.modbus.connections, sc, workspace.modbus.share),
        devices: unionScopedDevices(workspace.modbus.devices, sc, workspace.modbus.share),
        points: unionScopedPoints(workspace.modbus.points, sc, workspace.modbus.share),
      })
    )
  } else {
    pack = /** @type {ModbusWorkspace} */ (normalizeModbus(workspace.modbus))
  }

  // support per-connection polling; if no points, report
  if (!pack.points.length) return { ok: false, error: '无点位，请先添加点位' }
  if (hasRunning(workspace, 'read')) {
    return {
      ok: true,
      skipped: true,
      polling: pack.polling,
      pollingByConnection: pack.pollingByConnection,
      values: pack.values,
    }
  }
  const targetConns = cidArg
    ? pack.connections.filter((/** @type {any} */ c) => c.id === cidArg)
    : pack.connections.filter((/** @type {any} */ c) => c.enabled !== false)
  if (cidArg && !targetConns.length) return { ok: false, error: `连接不存在: ${cidArg}` }
  if (!targetConns.length) return { ok: false, error: '无可用连接' }
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
    const framesLog = []
    const framesByConnection = { ...(pack.framesByConnection || {}) }
    const pollingByConnection = { ...(pack.pollingByConnection || {}) }
    for (const connObj of targetConns) {
      const conn = connObj.conn
      const connId = connObj.id
      const pts = pack.points.filter((/** @type {any} */ p) => (p.connectionId || p.connId) === connId)
      if (!pts.length) {
        // still update polling timestamp for empty but enabled connection?
        pollingByConnection[connId] = {
          ...(pollingByConnection[connId] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }),
          lastAt: Date.now(),
          lastOk: true,
          error: '',
        }
        continue
      }
      const transport = transportOf(opts)
      const scopes = planScopedReadBatches(stampPoints({ ...pack, points: pts }))
      const interval = pollingByConnection[connId] || {
        enabled: false,
        intervalMs: 1000,
        lastAt: 0,
        lastOk: true,
        error: '',
      }
      let connOk = true
      for (const scope of scopes) {
        const batchConnObj = pack.connections.find((/** @type {any} */ c) => c.id === scope.connectionId) || connObj
        const batchDevice = pack.devices.find((/** @type {any} */ d) => d.id === scope.deviceId) || {
          id: scope.deviceId,
          unitId: scope.unitId,
        }
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
            pack,
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
          values = scatterBatch(values, pack.points, batch, raw, !!ran.ok, ran.ok ? '' : ran.error || '')
          let f = ran.frames || framesOf(ran)
          if (!f && batchConnObj && batchConnObj.conn && batchConnObj.conn.sim) {
            f = {
              request: `SIM TX ${batch.fc}@${batch.address}×${batch.count}`,
              response: `SIM RX ${raw.slice(0, 3).join(',')}`,
              trace: [],
              frameFormat: 'rtu-adu',
            }
          }
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
          if (entry) {
            framesLog.push(entry)
            if (!framesByConnection[connId]) framesByConnection[connId] = []
            framesByConnection[connId] = framesByConnection[connId].concat([entry]).slice(-500)
          }
          await commitPollResult(home, room.cwd, {
            baseConfigVersion: pack.configVersion,
            connectionId: scope.connectionId || connId,
            deviceId: scope.deviceId,
            pointValues: pointValuesOfBatch(values, pack, batch),
            frame: entry,
          })
        }
        if (!connOk) break
      }
      pollingByConnection[connId] = {
        ...interval,
        lastAt: Date.now(),
        lastOk: connOk && !timedOut,
        error: timedOut ? '轮询超时' : connOk ? '' : '轮询部分失败',
      }
    }
    const alarmEval = evaluateAlarms({
      points: pack.points,
      values,
      prevState: pack.alarmState || pack.alarmActive,
      pollingByConnection,
      connections: pack.connections,
      opts: { deadband: 1 },
    })
    const alarms = {
      next: alarmEval.next,
      fired: alarmEval.fired.filter((/** @type {any} */ f) => f.point),
      cleared: alarmEval.recovered.filter((/** @type {any} */ r) => r.point),
      commFired: alarmEval.fired.filter((/** @type {any} */ f) => !f.point),
      commCleared: alarmEval.recovered.filter((/** @type {any} */ r) => !r.point),
    }
    const activeBool = Object.fromEntries(
      Object.entries(alarmEval.next)
        .filter(([, v]) => v && v.condition === 'active' && v.group === 'process')
        .map(([k]) => [k, true]),
    )
    if (alarmEval.fired.length) {
      const procFired = alarmEval.fired.filter((/** @type {any} */ f) => f.point)
      const commFired = alarmEval.fired.filter((/** @type {any} */ f) => f.connectionId)
      if (procFired.length) {
        await recordBenchEvent(
          home,
          room.cwd,
          {
            action: 'alarm',
            ok: false,
            summary: `越限告警：${procFired
              .slice(0, 5)
              .map((/** @type {any} */ item) => {
                const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
                return `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
              })
              .join('；')}`,
          },
          { source: 'system' },
        )
        void notifyBenchEvent(
          home,
          room.cwd,
          `Vision 告警：${procFired
            .slice(0, 3)
            .map((/** @type {any} */ item) => {
              const limit = item.kind === 'max' ? item.point.alarmMax : item.point.alarmMin
              return `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}${item.kind === 'max' ? `>${limit}` : `<${limit}`}`
            })
            .join('；')}`,
        ).catch(() => {})
      }
      if (commFired.length) {
        await recordBenchEvent(
          home,
          room.cwd,
          {
            action: 'alarm',
            ok: false,
            summary: `通信告警：${commFired
              .slice(0, 3)
              .map((/** @type {any} */ c) => c.label || c.connectionId)
              .join('；')}`,
          },
          { source: 'system' },
        )
      }
    }
    if (alarmEval.recovered.length) {
      const procRec = alarmEval.recovered.filter((/** @type {any} */ r) => r.point)
      const commRec = alarmEval.recovered.filter((/** @type {any} */ r) => r.connectionId && !r.point)
      if (procRec.length) {
        await recordBenchEvent(
          home,
          room.cwd,
          {
            action: 'alarm-clear',
            ok: true,
            summary: `告警恢复：${procRec
              .slice(0, 5)
              .map((/** @type {any} */ item) => `${pointLabel(item.point)}=${decodeValue(item.point, item.raw ?? item.alarm?.value)}`)
              .join('；')}`,
          },
          { source: 'system' },
        )
      }
      if (commRec.length) {
        await recordBenchEvent(
          home,
          room.cwd,
          {
            action: 'alarm-clear',
            ok: true,
            summary: `通信恢复：${commRec
              .slice(0, 3)
              .map((/** @type {any} */ c) => c.connectionId)
              .join('；')}`,
          },
          { source: 'system' },
        )
      }
    }
    await commitPollResult(home, room.cwd, {
      baseConfigVersion: pack.configVersion,
      pollingByConnection,
    })
    const saved = await saveWorkspaceAsync(home, room.cwd, {
      modbus: {
        alarmActive: activeBool,
        alarmState: alarmEval.next,
        polling:
          pollingByConnection[pack.activeConnectionId || ''] ||
          pollingByConnection[targetConns[0]?.id || ''] ||
          pack.polling,
        pollingByConnection,
        version: 3,
      },
    })
    return {
      ok,
      skipped: false,
      partial: timedOut,
      timedOut,
      values: saved.workspace.modbus.values,
      polling: saved.workspace.modbus.polling,
      pollingByConnection: saved.workspace.modbus.pollingByConnection,
      framesLog,
      framesByConnection: saved.workspace.modbus.framesByConnection,
      error: ok ? undefined : timedOut ? '轮询超时' : '',
    }
  } finally {
    pollLocks.delete(lockKey)
    if (!cidArg) pollLocks.delete(room.cwd)
  }
}
