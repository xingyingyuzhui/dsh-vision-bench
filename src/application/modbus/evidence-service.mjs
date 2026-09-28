// @ts-check
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { peekSharedDebugRuntime } from '../debug/debug-runtime.mjs'
import { collectVisibleEvidenceRefs, projectVisibleFocus } from './evidence-scope.mjs'
import { loadSessionViewForRead } from './workspace-session-view.mjs'

/**
 * Snapshot lookups from the host debug runtime, if one is running. Never creates it.
 * @returns {import('./evidence-scope.mjs').DebugSnapshotResolver | null}
 */
export function hostDebugSnapshotResolver() {
  const runtime = peekSharedDebugRuntime()
  if (!runtime) return null
  return {
    latestOwnedSnapshotRef: runtime.latestOwnedSnapshotRef,
    resolveOwnedSnapshotRef: runtime.resolveOwnedSnapshotRef,
  }
}

/**
 * @param {{ workspace: any, pack: any, sessionId?: string, cwd: string }} view
 * @returns {import('./evidence-scope.mjs').EvidenceScope}
 */
export function evidenceScopeOf(view) {
  return {
    workspace: view.workspace,
    pack: view.pack,
    sessionId: String(view.sessionId || '').trim(),
    cwd: view.cwd,
    debug: hostDebugSnapshotResolver(),
  }
}

/**
 * Evidence refs for a view the caller already loaded (same snapshot as the response).
 * @param {{ workspace: any, pack: any, sessionId?: string, cwd: string }} view
 */
export function evidenceRefsForView(view) {
  return collectVisibleEvidenceRefs(evidenceScopeOf(view))
}

/**
 * Focus as seen by this caller (foreign focus empty, unverifiable rows hidden).
 * @param {{ workspace: any, pack: any, sessionId?: string, cwd: string }} view
 */
export function focusForView(view) {
  return projectVisibleFocus(view.workspace, evidenceScopeOf(view))
}

/**
 * Read-only session evidence view. Never persists a claim.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {string} [sessionId] trusted origin session, never taken from evidence rows
 * @returns {{ ok: true, evidence: any[], workspace: any, pack: any } | { ok: false, errorCode: string, error: string }}
 */
export const buildEvidenceRefs = (home, cwd, sessionId = '') => {
  const sid = String(sessionId || '').trim()
  if (!sid) {
    const workspace = loadWorkspace(home, cwd)
    if (isScopePartitioned(workspace.modbus)) {
      return {
        ok: false,
        errorCode: ERROR_CODES.SESSION_REQUIRED,
        error: '该工作区已按会话隔离，evidence 必须携带 sessionId',
      }
    }
    const pack = normalizeModbus(workspace.modbus)
    return { ok: true, evidence: evidenceRefsForView({ workspace, pack, sessionId: '', cwd }), workspace, pack }
  }
  const view = loadSessionViewForRead(home, cwd, sid)
  return {
    ok: true,
    evidence: evidenceRefsForView({ workspace: view.workspace, pack: view.pack, sessionId: sid, cwd }),
    workspace: view.workspace,
    pack: view.pack,
  }
}
