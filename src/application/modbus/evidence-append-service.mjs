// @ts-check
import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import { workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { hostDebugSnapshotResolver } from './evidence-service.mjs'
import { ownedBy, resolveEvidenceBatch } from './evidence-scope.mjs'
import { claimWorkspaceSync, modbusForSession } from './workspace-session-view.mjs'

const EVIDENCE_KEEP = 20

/**
 * In-memory session view of a workspace loaded inside the write lock.
 * Never persists a legacy claim.
 *
 * @param {any} current layered workspace
 * @param {string} sessionId
 * @param {string} cwd
 * @returns {{ ok: true, scope: import('./evidence-scope.mjs').EvidenceScope } | { ok: false, errorCode: string, error: string }}
 */
export function lockedEvidenceScope(current, sessionId, cwd) {
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid) {
    if (isScopePartitioned(current?.modbus)) {
      return { ok: false, errorCode: ERROR_CODES.SESSION_REQUIRED, error: '该工作区已按会话隔离，必须携带 sessionId' }
    }
    return {
      ok: true,
      scope: { workspace: current, pack: normalizeModbus(current?.modbus), sessionId: '', cwd, debug: hostDebugSnapshotResolver() },
    }
  }
  const view = claimWorkspaceSync(current, sid).workspace
  return {
    ok: true,
    scope: { workspace: view, pack: modbusForSession(view, sid), sessionId: sid, cwd, debug: hostDebugSnapshotResolver() },
  }
}

/**
 * Another session's focus cannot be written through.
 * @param {any} focus
 * @param {string} sessionId
 */
export function focusOwnerConflict(focus, sessionId) {
  const owner = String(focus?.sessionId || '').trim()
  if (!owner || ownedBy(focus, sessionId)) return null
  return { ok: false, errorCode: ERROR_CODES.SESSION_MISMATCH, error: '当前焦点属于其他会话，不能写入' }
}

/**
 * @param {unknown} evidence
 * @returns {{ ok: true, list: any[] } | { ok: false, errorCode: string, error: string }}
 */
export function evidenceList(evidence) {
  if (Array.isArray(evidence)) return { ok: true, list: evidence }
  if (evidence && typeof evidence === 'object') return { ok: true, list: [evidence] }
  return { ok: false, errorCode: ERROR_CODES.INVALID_FIELD, error: 'evidence 必须是数组或对象' }
}

/**
 * Validate every row against the caller's view, then append in one locked write.
 * Any failure leaves focus and disk untouched.
 *
 * @param {string} home
 * @param {string | undefined} cwd
 * @param {unknown} evidence
 * @param {unknown} [sessionId] trusted origin session only
 */
export const appendEvidence = async (home, cwd, evidence, sessionId = '') => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const parsed = evidenceList(evidence)
  if (!parsed.ok) return parsed
  if (!parsed.list.length) return { ok: false, error: '缺少 evidence', errorCode: ERROR_CODES.TARGET_REQUIRED }
  const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
  const saved = await workspaceRepository(home).updateRuntime(room.cwd, async (/** @type {any} */ current) => {
    const built = lockedEvidenceScope(current, sid, room.cwd)
    if (!built.ok) return built
    const conflict = focusOwnerConflict(current.focus, sid)
    if (conflict) return conflict
    const batch = resolveEvidenceBatch(built.scope, parsed.list)
    if (!batch.ok) return { ok: false, errorCode: batch.errorCode, error: batch.error }
    const focus = current.focus && typeof current.focus === 'object' ? current.focus : {}
    const prevRows = Array.isArray(focus.evidence) ? focus.evidence : []
    return {
      ok: true,
      workspace: {
        ...current,
        focus: {
          ...focus,
          sessionId: String(focus.sessionId || '').trim() || sid,
          evidence: [...prevRows, ...batch.rows].slice(-EVIDENCE_KEEP),
        },
      },
    }
  })
  if (!saved || saved.ok === false) {
    return { ok: false, error: saved?.error || '证据保存失败', errorCode: saved?.errorCode }
  }
  const rows = Array.isArray(saved.workspace?.focus?.evidence) ? saved.workspace.focus.evidence : []
  return { ok: true, evidence: rows.filter((/** @type {any} */ r) => ownedBy(r, sid)) }
}
