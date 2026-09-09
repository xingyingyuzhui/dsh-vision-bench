// @ts-check
import { applyShareFlags } from '../modbus/config-scope-service.mjs'

/**
 * `share.update`: flags may arrive as `value.share` or flat on `value`; `value.confirmed`
 * acknowledges the revoke dialog. Runs on the LAYERED modbus (see resolveMutationScope).
 * @param {any} workspace
 * @param {any} op
 * @param {any} value
 * @param {string} sessionId
 * @returns {any}
 */
export function applyShare(workspace, op, value, sessionId) {
  if (op !== 'update') return { ok: false, errorCode: 'UNKNOWN_OP', error: 'share 仅支持 update' }
  const src = value && typeof value === 'object' ? value : {}
  const flags = src.share && typeof src.share === 'object' ? src.share : src
  const ran = applyShareFlags(workspace.modbus, sessionId, flags, { confirmed: src.confirmed === true })
  if (!ran.ok) {
    return {
      ok: false,
      errorCode: ran.errorCode,
      error: ran.error,
      needsConfirm: ran.needsConfirm === true,
      revoked: ran.revoked || [],
    }
  }
  workspace.modbus = ran.modbus
  const parts = []
  if (ran.published.length) parts.push(`共享 ${ran.published.join('/')}`)
  if (ran.revoked.length) parts.push(`取消共享 ${ran.revoked.join('/')}`)
  return {
    ok: true,
    workspace,
    summary: parts.length ? `工作区共享：${parts.join('；')}` : '更新工作区共享设置',
    changedIds: [],
    share: ran.modbus.share,
    published: ran.published,
    revoked: ran.revoked,
  }
}
