// @ts-check
import { DEBUG_ERRORS, DebugError } from './errors.mjs'

/**
 * Derives a target key and its identity strength from hardware/workspace spec.
 *
 * @param {{
 *   backend?: string,
 *   interfaceName?: string,
 *   target?: string,
 *   probeSerial?: string,
 *   workspaceCwd?: string,
 * }} spec
 * @returns {{ key: string, identityStrength: 'strong' | 'weak' }}
 */
export function createTargetKey(spec) {
  const backend = spec.backend || 'gdb-openocd'
  if (backend === 'keil-simulator') {
    return {
      key: 'keil-simulator:GLOBAL',
      identityStrength: 'weak',
    }
  }

  const iface = spec.interfaceName || 'unknown-iface'
  const probeSerial = spec.probeSerial ? String(spec.probeSerial).trim() : ''

  if (probeSerial) {
    return {
      key: `${backend}:${iface}:${probeSerial}`,
      identityStrength: 'strong',
    }
  }
  return {
    key: `${backend}:${iface}:GLOBAL`,
    identityStrength: 'weak',
  }
}

/**
 * Manages exclusive target leases for hardware/simulator debug targets.
 */
export class TargetLeaseManager {
  constructor() {
    /** @type {Map<string, {
     *   targetKey: string,
     *   sessionId: string,
     *   ownerSessionId: string,
     *   workspaceCwd: string,
     *   acquiredAt: number,
     *   identityStrength: 'strong' | 'weak',
     * }>} */
    this.leases = new Map()
  }

  /**
   * Acquires exclusive lease for a debug target.
   *
   * @param {{
   *   backend?: string,
   *   interfaceName?: string,
   *   target?: string,
   *   probeSerial?: string,
   *   workspaceCwd?: string,
   * }} spec
   * @param {{
   *   sessionId: string,
   *   ownerSessionId: string,
   *   workspaceCwd: string,
   * }} context
   * @returns {{
   *   targetKey: string,
   *   sessionId: string,
   *   ownerSessionId: string,
   *   workspaceCwd: string,
   *   acquiredAt: number,
   *   identityStrength: 'strong' | 'weak',
   * }}
   */
  acquireLease(spec, context) {
    const { key, identityStrength } = createTargetKey({
      ...spec,
      workspaceCwd: context.workspaceCwd,
    })

    const existing = this.leases.get(key)
    if (existing) {
      if (existing.sessionId !== context.sessionId) {
        throw new DebugError(DEBUG_ERRORS.TARGET_BUSY, `调试目标已被其他会话占用 (${key})`, {
          targetKey: key,
          currentSessionId: existing.sessionId,
          currentOwner: existing.ownerSessionId,
        })
      }
      return existing
    }

    const lease = {
      targetKey: key,
      sessionId: context.sessionId,
      ownerSessionId: context.ownerSessionId,
      workspaceCwd: context.workspaceCwd,
      acquiredAt: Date.now(),
      identityStrength,
    }

    this.leases.set(key, lease)
    return lease
  }

  /**
   * Releases lease owned by sessionId.
   *
   * @param {string} sessionId
   * @param {string} [ownerSessionId]
   * @returns {boolean}
   */
  releaseLease(sessionId, ownerSessionId) {
    for (const [key, lease] of this.leases.entries()) {
      if (lease.sessionId === sessionId) {
        if (ownerSessionId && lease.ownerSessionId !== ownerSessionId) {
          throw new DebugError(DEBUG_ERRORS.NOT_OWNER, '无权释放该目标的调试租约: 会话不匹配', {
            sessionId,
            ownerSessionId,
            targetKey: key,
          })
        }
        this.leases.delete(key)
        return true
      }
    }
    return false
  }

  /**
   * Verifies that sessionId currently holds the lease for targetKey.
   *
   * @param {string} sessionId
   * @param {string} targetKey
   * @returns {boolean}
   */
  verifyLease(sessionId, targetKey) {
    const lease = this.leases.get(targetKey)
    return Boolean(lease && lease.sessionId === sessionId)
  }

  /**
   * Gets lease info for a targetKey.
   *
   * @param {string} targetKey
   */
  getLease(targetKey) {
    return this.leases.get(targetKey) || null
  }

  /**
   * Clears all leases (e.g. during runtime shutdown).
   */
  clearAll() {
    this.leases.clear()
  }
}
