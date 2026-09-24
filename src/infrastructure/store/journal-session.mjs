// @ts-check
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { loadWorkspace, saveWorkspaceAsync } from './workspace-store.mjs'

/** @type {Map<string, { boundId: string, touchedAt: number }>} */
const touchedSessionCache = new Map()

/** @param {string} home @param {string} cwd @param {unknown} sessionId */
export const bindSession = async (home, cwd, sessionId) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const id = String(sessionId || '').trim()
  if (!id) return { ok: false, error: '缺少会话 id' }
  const saved = await saveWorkspaceAsync(home, room.cwd, { session: { boundId: id } })
  if (!saved.ok) return saved
  return {
    ok: true,
    boundId: saved.workspace.session.boundId,
    prevBoundId: saved.prev?.session?.boundId || '',
  }
}

/** @param {string} home @param {unknown} cwd @param {unknown} sessionId */
export const touchServiceSession = async (home, cwd, sessionId) => {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!id || !cwd) return { ok: false, skipped: 'no-session' }
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  const cacheKey = `${home}:${room.cwd}`
  const cached = touchedSessionCache.get(cacheKey)
  if (cached && cached.boundId === id && Date.now() - cached.touchedAt < 5000) {
    return { ok: true, boundId: id, unchanged: true }
  }
  const prev = loadWorkspace(home, room.cwd)
  const cur = prev?.session?.boundId ? prev.session.boundId : ''
  if (cur === id) {
    touchedSessionCache.set(cacheKey, { boundId: id, touchedAt: Date.now() })
    return { ok: true, boundId: id, unchanged: true }
  }
  const res = await bindSession(home, /** @type {string} */ (room.cwd), id)
  if (res?.ok) {
    touchedSessionCache.set(cacheKey, { boundId: id, touchedAt: Date.now() })
  }
  return res
}

/** @param {string} home @param {string} cwd */
export const unbindSession = async (home, cwd) => {
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, error: room.error }
  touchedSessionCache.delete(`${home}:${room.cwd}`)
  const saved = await saveWorkspaceAsync(home, room.cwd, { session: { boundId: '' } })
  if (!saved.ok) return saved
  return { ok: true, boundId: '' }
}
