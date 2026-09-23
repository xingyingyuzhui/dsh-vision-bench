// @ts-check
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { writeJsonAtomicSync } from '../persistence/atomic-json.mjs'
import { defaultDshHome } from './dsh-home.mjs'

export { defaultDshHome }

/** @type {readonly ['python', 'uv4', 'openocd', 'gdb']} */
export const BINDING_KEYS = ['python', 'uv4', 'openocd', 'gdb']

export const emptyBindings = () => ({ python: '', uv4: '', openocd: '', gdb: '' })

/** @param {string} home */
export const storeDir = (home) => join(home, 'vision-bench')

/** @param {string} home */
export const bindingsPath = (home) => join(storeDir(home), 'bindings.json')

/** @param {unknown} input */
export const normalizeBindings = (input) => {
  const out = emptyBindings()
  if (!input || typeof input !== 'object') return out
  const src = /** @type {Record<string, unknown>} */ (input)
  for (const key of BINDING_KEYS) {
    const value = src[key]
    out[key] = typeof value === 'string' ? value.trim() : ''
  }
  return out
}

/** @param {ReturnType<typeof emptyBindings>} bindings */
export const validateBindings = (bindings) => {
  const errors = []
  for (const key of BINDING_KEYS) {
    const value = bindings[key]
    if (value && !isAbsolute(value)) errors.push(`${key} 必须是绝对路径`)
  }
  return errors
}

/**
 * @param {unknown} value
 * @param {(path: string) => boolean} [exists]
 */
export const probePath = (value, exists = existsSync) => {
  if (!value) return { bound: false, exists: false }
  try {
    return { bound: true, exists: !!exists(/** @type {string} */ (value)) }
  } catch {
    return { bound: true, exists: false }
  }
}

/**
 * @param {ReturnType<typeof emptyBindings>} bindings
 * @param {(path: string) => boolean} [exists]
 */
export const probeBindings = (bindings, exists = existsSync) => {
  /** @type {Record<string, { bound: boolean, exists: boolean }>} */
  const health = {}
  for (const key of BINDING_KEYS) health[key] = probePath(bindings[key], exists)
  return health
}

/** @param {string | undefined} home */
export const loadBindings = (home) => {
  try {
    return normalizeBindings(JSON.parse(readFileSync(bindingsPath(/** @type {string} */ (home)), 'utf8')))
  } catch {
    return emptyBindings()
  }
}

/** @param {string} home @param {unknown} input */
export const saveBindings = (home, input) => {
  const bindings = normalizeBindings(input)
  const errors = validateBindings(bindings)
  if (errors.length > 0) {
    return { ok: false, error: errors.join('；'), bindings }
  }
  mkdirSync(storeDir(home), { recursive: true })
  writeJsonAtomicSync(bindingsPath(home), bindings)
  return { ok: true, bindings }
}
