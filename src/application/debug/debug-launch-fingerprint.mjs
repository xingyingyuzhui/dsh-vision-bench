// @ts-check
import { createHash } from 'node:crypto'

/**
 * Normalizes launch spec fields into a canonical JSON payload and computes a SHA-256 fingerprint.
 *
 * @param {{
 *   backend?: string,
 *   artifactPath?: string,
 *   artifactSha256?: string,
 *   projectPath?: string,
 *   targetName?: string,
 *   interfaceName?: string,
 *   openocdTarget?: string,
 *   probeSerial?: string,
 * }} spec
 * @returns {string}
 */
export function computeLaunchFingerprint(spec = {}) {
  const canonical = {
    artifactPath: String(spec.artifactPath || '').trim(),
    artifactSha256: String(spec.artifactSha256 || '').trim(),
    backend: String(spec.backend || 'gdb-openocd').trim(),
    interfaceName: String(spec.interfaceName || '').trim(),
    openocdTarget: String(spec.openocdTarget || '').trim(),
    probeSerial: String(spec.probeSerial || '').trim(),
    projectPath: String(spec.projectPath || '').trim(),
    targetName: String(spec.targetName || '').trim(),
  }

  const json = JSON.stringify(canonical)
  return createHash('sha256').update(json).digest('hex')
}
