// @ts-check
import { originOf } from '../../domain/modbus/journal-model.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { recordBenchEvent } from '../../infrastructure/store/journal-store.mjs'
import { normalizeFocusRequest } from '../../infrastructure/store/focus-store.mjs'
import { workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { TARGET_CODES, resolveTarget as resolveUnifiedTarget } from '../../domain/modbus/target-resolver-service.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { deviceDisabledOf } from '../../domain/modbus/validation.mjs'
import { focusOwnerConflict, lockedEvidenceScope } from './evidence-append-service.mjs'
import { resolveEvidenceBatch } from './evidence-scope.mjs'
/**
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 */

/**
 * @param {any} rt
 */
function targetFailure(rt) {
  if (rt.errorCode === 'VIZ_NOT_FOUND') return { ok: false, error: rt.error, errorCode: 'VIZ_NOT_FOUND' }
  const code =
    rt.errorCode === TARGET_CODES.TARGET_REQUIRED
      ? ERROR_CODES.TARGET_REQUIRED
      : rt.errorCode === TARGET_CODES.TARGET_MISMATCH
        ? ERROR_CODES.TARGET_MISMATCH
        : ERROR_CODES.TARGET_REQUIRED
  if (/不存在/.test(String(rt.error || '')) && code === ERROR_CODES.TARGET_REQUIRED)
    return { ok: false, error: rt.error, errorCode: ERROR_CODES.TARGET_MISMATCH }
  return { ok: false, error: rt.error, errorCode: code }
}

/**
 * Point UI focus at a target. Identity comes from `origin` (Host command origin or
 * the UI page scope), never from the business body. Target, version, owner and every
 * evidence row are checked inside one locked write; a refusal writes nothing.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {ModbusCommandBody} body
 * @param {{ source?: string, sessionId?: string }} [origin]
 */
export const requestFocus = async (home, cwd, body, origin = originOf(body)) => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error, errorCode: ERROR_CODES.TARGET_REQUIRED }
  const source = origin?.source === 'agent' ? 'agent' : 'user'
  const sessionId = String(origin?.sessionId || '').trim()
  const rawEvidence = Array.isArray(body?.evidence) ? body.evidence.slice(0, 20) : []
  const tempWatchIds = (Array.isArray(body?.tempWatchIds) ? body.tempWatchIds : Array.isArray(body?.tempWatch) ? body.tempWatch : [])
    .map((/** @type {unknown} */ x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 32)
  const wantForeground = body?.foreground === true
  const badgeOnly = !!(body?.badgeOnly === true || (source === 'agent' && !wantForeground))

  /** @type {any} */
  let outcome = null
  const saved = await workspaceRepository(home).updateRuntime(room.cwd, async (/** @type {any} */ current) => {
    const built = lockedEvidenceScope(current, sessionId, room.cwd)
    if (!built.ok) return built
    const conflict = focusOwnerConflict(current.focus, sessionId)
    if (conflict) return conflict
    const pack = built.scope.pack
    const rawTarget = body && (body.target || body.focus || body) ? body.target || body.focus || body : {}
    const target =
      normalizeFocusRequest(rawTarget) ||
      normalizeFocusRequest({
        connectionId: rawTarget.connectionId || rawTarget.connId,
        deviceId: rawTarget.deviceId,
        pointId: rawTarget.pointId,
        frameId: rawTarget.frameId,
        trendKey: rawTarget.trendKey,
        alarmId: rawTarget.alarmId,
        visualizationId: rawTarget.visualizationId,
        kind: rawTarget.kind,
        version: pack.configVersion || 1,
        by: source,
      })
    if (!target) {
      return {
        ok: false,
        error: '缺少聚焦目标 connectionId/deviceId/pointId/frameId',
        errorCode: ERROR_CODES.TARGET_REQUIRED,
      }
    }
    const rt = resolveUnifiedTarget(pack, target)
    if (!rt.ok) return targetFailure(rt)
    if (target.connectionId && target.deviceId && deviceDisabledOf(pack, target.connectionId, target.deviceId)) {
      return { ok: false, error: '设备已禁用', errorCode: ERROR_CODES.DEVICE_DISABLED }
    }
    const batch = resolveEvidenceBatch(built.scope, rawEvidence)
    if (!batch.ok) return { ok: false, errorCode: batch.errorCode, error: batch.error }
    const prev = current.focus ? current.focus.request : null
    const nextReq = {
      connectionId: target.connectionId || '',
      deviceId: target.deviceId || '',
      pointId: target.pointId || '',
      frameId: target.frameId || '',
      trendKey: target.trendKey || '',
      alarmId: target.alarmId || '',
      visualizationId: target.visualizationId || '',
      kind: target.kind || '',
      at: Date.now(),
      by: source,
      version: pack.configVersion || 1,
    }
    outcome = { nextReq, prev: prev || null, evidence: batch.rows, rt, configVersion: pack.configVersion || 1 }
    return {
      ok: true,
      workspace: {
        ...current,
        focus: {
          sessionId,
          request: nextReq,
          prev: prev || null,
          tempWatchIds,
          badgeOnly,
          evidence: batch.rows,
        },
      },
    }
  })
  if (!saved || saved.ok === false || !outcome) {
    return { ok: false, error: saved?.error || '聚焦失败', errorCode: saved?.errorCode }
  }
  const { nextReq, prev, evidence, rt, configVersion } = outcome
  try {
    await recordBenchEvent(
      home,
      room.cwd,
      {
        action: 'focus',
        ok: true,
        summary: `聚焦 ${
          nextReq.visualizationId
            ? `组件 ${rt.visualization?.name || nextReq.visualizationId}`
            : [nextReq.connectionId, nextReq.deviceId, nextReq.pointId, nextReq.frameId].filter(Boolean).join('/') ||
              '未知目标'
        }`,
      },
      { source, sessionId },
    )
  } catch {}
  return {
    ok: true,
    sessionId,
    focus: nextReq,
    prev,
    tempWatchIds,
    badgeOnly,
    evidence,
    configVersion,
  }
}
