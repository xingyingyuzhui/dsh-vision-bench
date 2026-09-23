// @ts-check
/**
 * Vision模式 as a declarative Agent preset (DSH 0.1.7+).
 *
 * DSH 0.1.7 replaced directory presets (`$DSH_HOME/.agent-presets/<id>/`) with
 * `@deepseek-ai/dsh-agent-preset` declarations carried by Cordis compositions;
 * "nothing reads that directory any more". The declaration is self-contained:
 * it restates the shipped `standard` child list (generated snapshot) and appends
 * the Vision agent tool row. Registration happens through the public
 * `agentPresets.register()` API from the Host plugin, so older harnesses that
 * only offer the directory contract (`agentPresets.copy`) keep the legacy seed
 * path untouched.
 *
 * @module
 */
import { dirname, join } from 'node:path'
import { buildStandardPresetChildren } from './standard-preset-snapshot.mjs'
import { checkOwnership } from './preset-overlay.mjs'
import { _existsSync, _renameSync } from './preset-transaction.mjs'

export const PRESET_ID = 'vision-bench'
export const PRESET_TITLE = 'Vision模式'
export const PRESET_DESCRIPTION = '标准编码能力，外加 Vision 调试与上位机接口：查询现场工程、编译、Modbus 读点和受控写点。'
/** Roster position behind the shipped presets (standard 1 … cordis 4). */
export const PRESET_ORDER = 10
/** Preset composition `name` — a package subpath, not the host plugin id. */
export const AGENT_PLUGIN_SPEC = 'dsh-vision-bench/agent'
export const HOST_PLUGIN_NAME = 'dsh-vision-bench'

export const REBUILD_INSTRUCTIONS_DECLARATIVE =
  '安全重建：Vision模式预设由插件声明注册（id: vision-bench，出现在 Agent presets roster）。' +
  '若 roster 行显示 broken，按其诊断修复插件包后重装/重载 dsh-vision-bench；' +
  '旧目录式预设在声明生效后会被整体改名备份到 .vision-bench.backup.<ISO>，请勿手工删除或复用该 id。'

const DUPLICATE_RETRY_ATTEMPTS = 3
const DUPLICATE_RETRY_DELAY_MS = 50

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @typedef {Object} PresetChildRow
 * @property {string} [id]
 * @property {string} name
 * @property {true} [group]
 * @property {Record<string, boolean | string>} [isolate]
 * @property {Record<string, unknown> | PresetChildRow[]} [config]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {Object} PresetDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} order
 * @property {PresetChildRow[]} plugins
 */

/**
 * @typedef {Object} DeclarationState
 * @property {'unknown' | 'declarative' | 'legacy'} mode
 * @property {'idle' | 'pending' | 'registered' | 'failed'} phase
 * @property {string} via
 * @property {string} at
 * @property {string} error
 * @property {string} migrationWarning
 * @property {string} backupDir
 */

/** @returns {DeclarationState} */
function idleDeclarationState() {
  return {
    mode: 'unknown',
    phase: 'idle',
    via: '',
    at: '',
    error: '',
    migrationWarning: '',
    backupDir: '',
  }
}

/** @type {DeclarationState} */
let declarationState = idleDeclarationState()

/**
 * HMR re-imports this module, so fibers coordinate through one global slot:
 * `epoch` drops a stale fiber's late write, `settled` is the previous fiber's
 * "wait until mount finishes, then unregister" chain.
 *
 * @typedef {Object} PresetDeclarationSlot
 * @property {number} epoch
 * @property {Promise<void>} settled
 */

const PRESET_DECLARATION_SLOT = Symbol.for('dsh-vision-bench.preset-declaration')

/** @returns {PresetDeclarationSlot} */
export function presetDeclarationSlot() {
  const host = /** @type {any} */ (globalThis)
  const current = host[PRESET_DECLARATION_SLOT]
  if (!current || typeof current.epoch !== 'number' || typeof current.settled?.then !== 'function') {
    /** @type {PresetDeclarationSlot} */
    const created = { epoch: 0, settled: Promise.resolve() }
    host[PRESET_DECLARATION_SLOT] = created
    return created
  }
  return current
}

/** @returns {DeclarationState} */
export function getDeclarationState() {
  return { ...declarationState }
}

/**
 * @param {Partial<DeclarationState>} patch
 * @param {number} [epoch] ignored when it is not the active fiber's epoch
 */
export function setDeclarationState(patch, epoch) {
  if (typeof epoch === 'number' && epoch !== presetDeclarationSlot().epoch) return
  declarationState = { ...declarationState, ...patch }
}

/** @param {number} [epoch] ignored when it is not the active fiber's epoch */
export function resetDeclarationState(epoch) {
  if (typeof epoch === 'number' && epoch !== presetDeclarationSlot().epoch) return
  declarationState = idleDeclarationState()
}

/**
 * Declarative registry contract (DSH 0.1.7+): `agentPresets.register()`. The
 * legacy directory contract (`agentPresets.copy()`, DSH ≤ 0.1.6) must keep the
 * seed path, and a registry offering both is treated as legacy.
 *
 * @param {any} agentPresets
 * @returns {boolean}
 */
export function isDeclarativeRegistry(agentPresets) {
  return !!(
    agentPresets &&
    typeof agentPresets.register === 'function' &&
    typeof agentPresets.copy !== 'function'
  )
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDuplicatePresetError(error) {
  return /Duplicate agent preset/.test(String((error && /** @type {any} */ (error).message) || error || ''))
}

/**
 * The self-contained Vision preset: shipped `standard` children plus the Vision
 * agent tool row. Rows are fresh per call so a caller may adapt them.
 *
 * @param {{ platform?: string }} [options]
 * @returns {PresetDefinition}
 */
export function buildVisionPresetDefinition(options = {}) {
  /** @type {PresetChildRow[]} */
  const plugins = [
    ...buildStandardPresetChildren(options),
    { id: 'vision-bench-tools', name: AGENT_PLUGIN_SPEC },
  ]
  return {
    id: PRESET_ID,
    name: PRESET_TITLE,
    description: PRESET_DESCRIPTION,
    order: PRESET_ORDER,
    plugins,
  }
}

/**
 * @typedef {Object} RegistrationResult
 * @property {boolean} ok
 * @property {string} via `agentPresets.register`, `external-declaration`, …
 * @property {string} [error]
 * @property {boolean} [delegated] the id is already declared by someone else
 * @property {PresetDefinition} definition
 * @property {(() => Promise<void>) | null} dispose
 */

/**
 * Register the declaration, retrying briefly when the id is taken: a previous
 * Host fiber may still be unregistering its own declaration.
 *
 * @param {any} agentPresets
 * @param {{ definition?: PresetDefinition, platform?: string, duplicateRetries?: number, retryDelayMs?: number }} [options]
 * @returns {Promise<RegistrationResult>}
 */
export async function registerVisionPreset(agentPresets, options = {}) {
  const definition = options.definition || buildVisionPresetDefinition(options)
  const attempts = options.duplicateRetries ?? DUPLICATE_RETRY_ATTEMPTS
  const delayMs = options.retryDelayMs ?? DUPLICATE_RETRY_DELAY_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      const dispose = await agentPresets.register(definition)
      return {
        ok: true,
        via: 'agentPresets.register',
        definition,
        dispose: typeof dispose === 'function' ? dispose : null,
      }
    } catch (error) {
      const message = String((error && /** @type {any} */ (error).message) || error)
      if (!isDuplicatePresetError(error)) {
        return { ok: false, via: 'agentPresets.register', error: message, definition, dispose: null }
      }
      if (attempt >= attempts) {
        // Another declaration owns the id (a user patch or another install).
        return { ok: true, via: 'external-declaration', delegated: true, definition, dispose: null }
      }
      await sleep(delayMs)
    }
  }
}

/**
 * @param {any} agentPresets
 * @returns {Promise<{ ok: boolean, error: string, row: any }>}
 */
export async function describeDeclaredPreset(agentPresets) {
  try {
    const rows = await agentPresets.list()
    const row = Array.isArray(rows) ? rows.find((entry) => entry && entry.id === PRESET_ID) : null
    if (!row) return { ok: false, error: `Agent presets roster 缺少 ${PRESET_ID} 声明`, row: null }
    if (row.broken) return { ok: false, error: `声明激活失败：${String(row.broken)}`, row }
    return { ok: true, error: '', row }
  } catch (error) {
    return { ok: false, error: String((error && /** @type {any} */ (error).message) || error), row: null }
  }
}

/**
 * @typedef {Object} LegacyMigrationResult
 * @property {boolean} ok
 * @property {boolean} migrated
 * @property {string} [error]
 * @property {string} [backupDir]
 */

/**
 * Move a legacy directory preset aside once the declaration is live. The whole
 * directory is renamed into a timestamped sibling backup — nothing is deleted,
 * and a foreign or unmarked directory is never touched (it may be someone
 * else's preset that merely shares the id).
 *
 * @param {string} home
 * @returns {LegacyMigrationResult}
 */
export function migrateLegacyPresetDir(home) {
  const dir = userPresetDir(home)
  if (!_existsSync(dir)) return { ok: true, migrated: false }
  const ownership = checkOwnership(dir)
  if (ownership.error) return { ok: false, migrated: false, error: ownership.error }
  if (!ownership.exists) {
    return { ok: false, migrated: false, error: 'Vision预设 id 已被其他预设占用（旧目录无归属标记）' }
  }
  const backupDir = join(dirname(dir), `.${PRESET_ID}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`)
  try {
    _renameSync(dir, backupDir)
  } catch (error) {
    return {
      ok: false,
      migrated: false,
      error: '旧目录预设迁移失败：' + String((error && /** @type {any} */ (error).message) || error),
    }
  }
  return { ok: true, migrated: true, backupDir }
}

export const userPresetDir = (/** @type {string} */ home) => join(home, '.agent-presets', PRESET_ID)

/**
 * @typedef {Object} DeclarationActivation
 * @property {boolean} ok
 * @property {string} via
 * @property {string} [error]
 * @property {string} at
 * @property {(() => Promise<void>) | null} dispose
 * @property {{ ok: boolean, error: string, row: any }} roster
 * @property {LegacyMigrationResult} migration
 */

/**
 * Register the declaration, verify its roster row, then migrate a legacy
 * directory preset. Records the outcome for `inspectPresetHealth`.
 *
 * @param {any} agentPresets
 * @param {string} home
 * @param {{ definition?: PresetDefinition, platform?: string, duplicateRetries?: number, retryDelayMs?: number, epoch?: number }} [options]
 * @returns {Promise<DeclarationActivation>}
 */
export async function activateVisionPresetDeclaration(agentPresets, home, options = {}) {
  const epoch = options.epoch
  setDeclarationState({ mode: 'declarative', phase: 'pending', via: '', at: '', error: '', migrationWarning: '', backupDir: '' }, epoch)
  const registration = await registerVisionPreset(agentPresets, options)
  if (!registration.ok) {
    setDeclarationState({ phase: 'failed', via: registration.via, error: registration.error || 'Vision预设声明注册失败' }, epoch)
    return {
      ok: false,
      via: registration.via,
      error: registration.error,
      at: '',
      dispose: null,
      roster: { ok: false, error: registration.error || '', row: null },
      migration: { ok: true, migrated: false },
    }
  }
  const roster = await describeDeclaredPreset(agentPresets)
  // Only the declaration this fiber just registered may displace the legacy
  // directory. An external owner of the id, or a broken row, leaves it in place.
  const migration =
    roster.ok && registration.via === 'agentPresets.register'
      ? migrateLegacyPresetDir(home)
      : { ok: true, migrated: false }
  const at = new Date().toISOString()
  setDeclarationState({
    phase: 'registered',
    via: registration.via,
    at,
    error: roster.ok ? '' : roster.error,
    migrationWarning: migration.ok ? '' : migration.error || '',
    backupDir: migration.backupDir || '',
  }, epoch)
  return {
    ok: roster.ok,
    via: registration.via,
    error: roster.ok ? undefined : roster.error,
    at,
    dispose: registration.dispose,
    roster,
    migration,
  }
}
