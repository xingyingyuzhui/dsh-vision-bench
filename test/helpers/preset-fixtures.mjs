// @ts-check
/**
 * Shared fixtures for preset overlay / transaction tests (P2-1).
 * Keeps fs-injection helpers in one place so split suites do not re-copy them.
 */
import { createRequire } from 'node:module'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadWorkspace } from '../../bench-store.mjs'
import { projectModbusForSession } from '../../src/application/modbus/config-scope-service.mjs'
import { trackPath } from './workspace-factory.mjs'

export function sessionPack(home, cwd, sessionId) {
  return projectModbusForSession(loadWorkspace(home, cwd).modbus, sessionId)
}

/** bench-preset routes fs through createRequire('node:fs'); patch that object. */
export function nodeFs() {
  return createRequire(import.meta.url)('node:fs')
}

/**
 * Process-wide mutex for node:fs monkey-patches.
 * Overlay and transaction suites run as separate files and must not patch concurrently.
 * @type {Promise<void>}
 */
let fsGate = Promise.resolve()

/**
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function exclusiveFs(fn) {
  let release = () => {}
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const prev = fsGate
  fsGate = wait
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * Patch node:fs under the process-wide mutex.
 * Each patch function receives the original method as its first argument.
 *
 * @param {Record<string, (orig: Function, ...args: any[]) => any>} patches
 * @param {(fs: any) => any} fn
 */
export async function withFsPatched(patches, fn) {
  return exclusiveFs(() => {
    const fs = nodeFs()
    /** @type {Record<string, any>} */
    const saved = {}
    for (const [k, impl] of Object.entries(patches)) {
      saved[k] = fs[k]
      fs[k] = (...args) => impl(saved[k], ...args)
    }
    try {
      return fn(fs)
    } finally {
      for (const [k, v] of Object.entries(saved)) fs[k] = v
    }
  })
}

/** @param {string} dir */
export async function leftoverTemps(dir) {
  return (await readdir(dir)).filter((n) => /\.tmp/.test(n))
}

/** Register overlay backupDir (sibling of the preset tree) for t.after cleanup. */
export function trackBackup(t, out) {
  if (out && out.backupDir) trackPath(t, out.backupDir)
}

export const LEGACY_PERSONA_A =
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 ls/select/build/read。不要猜测用户选了哪个工程。'

export const LEGACY_PERSONA_B =
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。'

/** @param {string} text */
export function personaComposition(text) {
  return ['- id: persona', '  name: x', '  config:', '    text: >-', '      ' + text, ''].join('\n')
}

/**
 * Write a owned legacy preset tree used by most transaction cases.
 * @param {string} dir
 * @param {{ persona?: string, preset?: string, marker?: string }} [opts]
 */
export async function seedOwnedLegacy(dir, opts = {}) {
  const before = personaComposition(opts.persona || LEGACY_PERSONA_A)
  const beforePreset = opts.preset ?? 'name: user-preset\n'
  const beforeMarker = opts.marker ?? JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
  await writeFile(join(dir, 'agent.cordis.yml'), before)
  await writeFile(join(dir, 'preset.yml'), beforePreset)
  await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
  return { before, beforePreset, beforeMarker }
}
