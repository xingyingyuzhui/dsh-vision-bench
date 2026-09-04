// @ts-check
import { existsSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

/**
 * Discovers ARMCC / ARMCLANG toolchain bin directories relative to UV4.exe.
 * Parity with runtime/keil_build.py toolchain_bins.
 *
 * @param {string} uv4 - Path to UV4.exe
 * @returns {string[]}
 */
export function toolchainBins(uv4) {
  if (!uv4) return []
  const uv4Path = resolve(uv4)
  const root = dirname(dirname(uv4Path))
  /** @type {string[]} */
  const found = []
  const candidates = [
    join(root, 'ARM', 'ARMCC', 'Bin'),
    join(root, 'ARM', 'ARMCC', 'bin'),
    join(root, 'ARM', 'ARMCLANG', 'bin'),
    join(root, 'ARM', 'ARMCLANG', 'Bin'),
  ]

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        found.push(candidate)
      }
    } catch {
      /* ignore fs errors */
    }
  }

  const uv4Dir = dirname(uv4Path)
  if (!found.includes(uv4Dir)) {
    found.push(uv4Dir)
  }

  return found
}

/**
 * Builds an environment object with toolchain bin paths prepended to PATH.
 * Does NOT mutate process.env.
 * Parity with runtime/keil_build.py build_env.
 *
 * @param {string} uv4 - Path to UV4.exe
 * @param {Record<string, string | undefined>} [baseEnv=process.env]
 * @returns {Record<string, string>}
 */
export function buildEnv(uv4, baseEnv = process.env) {
  const env = { ...baseEnv }
  const extra = toolchainBins(uv4)
  if (extra.length > 0) {
    const extraPath = extra.join(delimiter)
    // Find PATH key (case-insensitive for Windows Path vs PATH)
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
    const existing = env[pathKey]
    env[pathKey] = existing ? `${extraPath}${delimiter}${existing}` : extraPath
  }
  return /** @type {Record<string, string>} */ (env)
}
