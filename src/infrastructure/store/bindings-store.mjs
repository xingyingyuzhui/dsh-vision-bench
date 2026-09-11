import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { writeJsonAtomicSync } from '../persistence/atomic-json.mjs'
import { defaultDshHome } from './dsh-home.mjs'

export { defaultDshHome }

export const BINDING_KEYS = ['python', 'uv4', 'openocd', 'gdb']

export const emptyBindings = () => ({ python: '', uv4: '', openocd: '', gdb: '' })

export const storeDir = (home) => join(home, 'vision-bench')

export const bindingsPath = (home) => join(storeDir(home), 'bindings.json')

export const normalizeBindings = (input) => {
  const out = emptyBindings()
  if (!input || typeof input !== 'object') return out
  for (const key of BINDING_KEYS) {
    const value = input[key]
    out[key] = typeof value === 'string' ? value.trim() : ''
  }
  return out
}

export const validateBindings = (bindings) => {
  const errors = []
  for (const key of BINDING_KEYS) {
    const value = bindings[key]
    if (value && !isAbsolute(value)) errors.push(`${key} 必须是绝对路径`)
  }
  return errors
}

export const probePath = (value, exists = existsSync) => {
  if (!value) return { bound: false, exists: false }
  try {
    return { bound: true, exists: !!exists(value) }
  } catch {
    return { bound: true, exists: false }
  }
}

export const probeBindings = (bindings, exists = existsSync) => {
  const health = {}
  for (const key of BINDING_KEYS) health[key] = probePath(bindings[key], exists)
  return health
}

export const loadBindings = (home) => {
  try {
    return normalizeBindings(JSON.parse(readFileSync(bindingsPath(home), 'utf8')))
  } catch {
    return emptyBindings()
  }
}

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
