// @ts-check
import { join } from 'node:path'
import { LEGACY_VISION_PERSONAS, PRESET_PERSONA, STANDARD_PERSONA, VISION_GUIDANCE } from './guidance.mjs'
import {
  loadOfficialPersonaConfig,
  readInstalledDshVersion,
  resolveShippedStandardDir,
} from './dsh-contract.mjs'
import {
  AGENT_PLUGIN_SPEC,
  HOST_PLUGIN_NAME,
  PRESET_DESCRIPTION,
  PRESET_ID,
  PRESET_TITLE,
  REBUILD_INSTRUCTIONS_DECLARATIVE,
  activateVisionPresetDeclaration,
  getDeclarationState,
  isDeclarativeRegistry,
  userPresetDir,
} from './preset-declaration.mjs'
import { validateManagedVisionComposition } from './preset-validate.mjs'
import { STANDARD_PRESET_SNAPSHOT_CONTRACT } from './standard-preset-snapshot.mjs'
import {
  MARKER,
  PRESET_BACKUP_FAILED,
  PRESET_RESTORE_FAILED,
  PRESET_WRITE_FAILED,
  _existsSync,
  _readFileSync,
  copyDirRecursive,
  isAlreadyExistsError,
  thrownMessage,
  writeAtomic,
} from './preset-transaction.mjs'
import {
  CORDIS_JS_TAG,
  OWNERSHIP_TEMPLATE,
  checkOwnership,
  ensurePresetOverlay as ensurePresetOverlayCore,
  isVisionToolRow,
  parseCompositionDocument,
  templateFieldsMatch,
} from './preset-overlay.mjs'

export { PRESET_BACKUP_FAILED, PRESET_WRITE_FAILED, PRESET_RESTORE_FAILED }
export { parseCompositionDocument }

/**
 * @typedef {{
 *   ok: boolean,
 *   error?: string,
 *   rebuildHelp?: string,
 *   unchanged?: boolean,
 *   dir?: string,
 *   via?: string,
 *   backupDir?: string | null,
 *   migrated?: boolean,
 * }} PresetSeedRecord
 * @typedef {{ dshPaths?: string[], personaConfig?: any, standardDir?: string, epoch?: number }} PresetCallOptions
 */
/** @type {PresetSeedRecord} */
let lastPresetSeed = { ok: true }

export function getLastPresetSeed() {
  return lastPresetSeed
}

/** @type {((value: unknown) => unknown) | null | undefined} */
let officialHealthConfig
/** @type {string} */
let officialHealthConfigError = ''

export async function resolveOfficialHealthConfig() {
  if (officialHealthConfig) return { config: officialHealthConfig }
  if (officialHealthConfig === null) {
    return { error: officialHealthConfigError || '未完成契约验证：无法加载官方 dsh-persona Config' }
  }
  try {
    officialHealthConfig = await loadOfficialPersonaConfig()
    officialHealthConfigError = ''
    return { config: officialHealthConfig }
  } catch (error) {
    officialHealthConfig = null
    officialHealthConfigError = `未完成契约验证：${error instanceof Error ? error.message : String(error)}`
    return { error: officialHealthConfigError }
  }
}

export {
  AGENT_PLUGIN_SPEC,
  HOST_PLUGIN_NAME,
  PRESET_ID,
  PRESET_TITLE,
  REBUILD_INSTRUCTIONS_DECLARATIVE,
  getDeclarationState,
  isDeclarativeRegistry,
  userPresetDir,
}

export { LEGACY_VISION_PERSONAS, PRESET_PERSONA, STANDARD_PERSONA, VISION_GUIDANCE }

export const PRESET_METADATA = [
  'name: ' + PRESET_TITLE,
  'description: ' + PRESET_DESCRIPTION,
  '',
].join('\n')

export const REBUILD_INSTRUCTIONS =
  '安全重建：备份 $DSH_HOME/.agent-presets/vision-bench 到带时间戳目录(.vision-bench.backup.<ISO>含 agent.cordis.yml/preset.yml/.dsh-vision-bench)，删除旧目录后 agentPresets.copy("standard","vision-bench","Vision模式")并重启'

/**
 * @param {string} dir
 * @param {{ personaConfig?: any }} [options]
 */
export const ensurePresetOverlay = (dir, options = {}) =>
  ensurePresetOverlayCore(dir, {
    personaConfig: options.personaConfig,
    presetId: PRESET_ID,
    presetMetadata: PRESET_METADATA,
    agentPluginSpec: AGENT_PLUGIN_SPEC,
    hostPluginName: HOST_PLUGIN_NAME,
    rebuildInstructions: REBUILD_INSTRUCTIONS,
  })

/**
 * @param {string} installed
 * @returns {string}
 */
function snapshotDriftWarning(installed) {
  if (!installed || installed === STANDARD_PRESET_SNAPSHOT_CONTRACT) return ''
  return `标准预设快照（${STANDARD_PRESET_SNAPSHOT_CONTRACT}）早于已安装 DSH（${installed}），如 roster 行 broken 请升级插件`
}

/**
 * @param {Record<string, any>} health
 * @param {string} installed
 */
function withSnapshotDriftWarning(health, installed) {
  const drift = snapshotDriftWarning(installed)
  if (!drift) return health
  return { ...health, warning: health.warning ? `${health.warning}；${drift}` : drift }
}

/**
 * Health of the declarative (DSH 0.1.7+) registration: the roster row is the
 * product, not a directory on disk.
 *
 * @param {import('./preset-declaration.mjs').DeclarationState} state
 */
function declarativePresetHealth(state) {
  const base = {
    id: PRESET_ID,
    title: PRESET_TITLE,
    via: state.via,
    generation: state.at,
    warning: state.migrationWarning,
    backupDir: state.backupDir,
    appliesOnNewSession: true,
  }
  if (state.phase === 'registered' && !state.error) {
    return {
      ...base,
      ok: true,
      error: '',
      nextStep: '新建 Session 后生效。已打开的 Session 保持原 generation，不会热更新。',
      unchanged: true,
    }
  }
  return {
    ...base,
    ok: false,
    error:
      state.phase === 'pending'
        ? 'Vision预设声明注册中（等待 agentPresets 服务）'
        : state.error || 'Vision预设声明未生效',
    nextStep: REBUILD_INSTRUCTIONS_DECLARATIVE,
    unchanged: false,
  }
}

/** @param {string} home @param {PresetCallOptions} [options] */
export async function inspectPresetHealth(home, options = {}) {
  const declaration = getDeclarationState()
  if (declaration.mode === 'declarative') {
    const installed = readInstalledDshVersion(options.dshPaths || [])
    return withSnapshotDriftWarning(declarativePresetHealth(declaration), installed)
  }
  const seed = getLastPresetSeed()
  const dir = userPresetDir(home)
  const composition = join(dir, 'agent.cordis.yml')
  const ownership = _existsSync(dir) ? checkOwnership(dir) : { exists: false }
  const payload = 'payload' in ownership ? ownership.payload : undefined
  const generation = payload && payload.lastManagedAt ? String(payload.lastManagedAt) : ''
  const fail = (/** @type {string} */ error) => ({
    ok: false,
    id: PRESET_ID,
    title: PRESET_TITLE,
    generation,
    error,
    nextStep: seed.rebuildHelp || REBUILD_INSTRUCTIONS,
    appliesOnNewSession: true,
    unchanged: seed.unchanged === true,
  })
  let personaConfig = options.personaConfig
  if (!personaConfig) {
    const resolved = await resolveOfficialHealthConfig()
    if (resolved.error || !resolved.config) return fail(resolved.error || '未完成契约验证：无法加载官方 dsh-persona Config')
    personaConfig = resolved.config
  }
  let parseError = ''
  if (_existsSync(composition)) {
    try {
      const parsed = parseCompositionDocument(_readFileSync(composition, 'utf8'))
      if (parsed.errors && parsed.errors.length) {
        parseError = String(parsed.errors[0].message || parsed.errors[0])
      } else {
        const contract = validateManagedVisionComposition(
          /** @type {{ items?: unknown[] } | null | undefined} */ (parsed.contents),
          personaConfig,
        )
        if (!contract.ok) parseError = contract.error
      }
    } catch (error) {
      parseError = thrownMessage(error)
    }
  } else if (!seed.error) {
    parseError = 'Vision预设尚未安装'
  }
  const error = seed.ok === false ? seed.error || 'Vision预设未更新' : parseError || ownership.error || ''
  if (error) return fail(error)
  return {
    ok: true,
    id: PRESET_ID,
    title: PRESET_TITLE,
    generation,
    error: '',
    nextStep: '新建 Session 后生效。已打开的 Session 保持原 generation，不会热更新。',
    appliesOnNewSession: true,
    unchanged: seed.unchanged === true,
  }
}

const inFlightSeeds = new Map()

/** @param {any} agentPresets @param {string} dir @param {PresetCallOptions} options */
async function copyStandardSource(agentPresets, dir, options) {
  if (agentPresets && typeof agentPresets.copy === 'function') {
    try {
      await agentPresets.copy('standard', PRESET_ID, PRESET_TITLE)
      return { ok: true, via: 'agentPresets.copy' }
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        return {
          ok: false,
          error: '从 standard 复制失败：' + thrownMessage(error),
        }
      }
    }
  }
  let standardDir
  try {
    standardDir = resolveShippedStandardDir(options.standardDir, options.dshPaths)
  } catch (error) {
    return { ok: false, error: thrownMessage(error) }
  }
  if (!_existsSync(standardDir)) {
    return { ok: false, error: '找不到 DSH standard 预设: ' + standardDir }
  }
  try {
    copyDirRecursive(standardDir, dir)
    return { ok: true, via: 'shipped-standard', standardDir }
  } catch (error) {
    return { ok: false, error: '复制 shipped standard 失败：' + thrownMessage(error) }
  }
}

/** @param {any} agentPresets @param {string} home @param {string} dir @param {PresetCallOptions} options */
async function _seedVisionBenchPresetInternal(agentPresets, home, dir, options) {
  // DSH 0.1.7+: the preset is a registered declaration, and the caller keeps
  // the returned disposer (registration is process-local — a standalone script
  // cannot seed a harness that is not its own process).
  if (isDeclarativeRegistry(agentPresets)) {
    const activation = await activateVisionPresetDeclaration(agentPresets, home, options)
    const result = {
      ok: activation.ok,
      via: activation.via,
      dir,
      error: activation.ok ? '' : activation.error || 'Vision预设声明未生效',
      migrated: activation.migration.migrated === true,
      backupDir: activation.migration.backupDir || '',
      dispose: activation.dispose,
      rebuildHelp: activation.ok ? undefined : REBUILD_INSTRUCTIONS_DECLARATIVE,
    }
    const { dispose, ...recorded } = result
    lastPresetSeed = recorded
    return result
  }
  const composition = join(dir, 'agent.cordis.yml')
  const marker = join(dir, MARKER)
  const finish = (/** @type {PresetSeedRecord} */ result) => {
    lastPresetSeed = result && typeof result === 'object' ? result : { ok: false, error: String(result) }
    return lastPresetSeed
  }
  const hasComposition = _existsSync(composition)
  const hasMarker = _existsSync(marker)
  if (hasComposition && !hasMarker) {
    return finish({ ok: false, error: 'Vision预设 id 已被其他预设占用', dir, rebuildHelp: REBUILD_INSTRUCTIONS })
  }
  if (hasComposition && hasMarker) {
    const ownership = checkOwnership(dir)
    if (ownership.error) {
      return finish({ ok: false, error: ownership.error, dir, rebuildHelp: REBUILD_INSTRUCTIONS })
    }
  }
  if (!hasComposition) {
    const copied = await copyStandardSource(agentPresets, dir, options)
    if (!copied.ok) {
      return finish({
        ok: false,
        error: copied.error || '未能创建Vision预设（需要可从 standard 复制）',
        rebuildHelp: REBUILD_INSTRUCTIONS,
      })
    }
  }
  if (!_existsSync(composition)) {
    return finish({
      ok: false,
      error: '未能创建Vision预设（需要可从 standard 复制）',
      rebuildHelp: REBUILD_INSTRUCTIONS,
    })
  }
  let personaConfig = options.personaConfig
  if (!personaConfig) {
    try {
      personaConfig = await loadOfficialPersonaConfig(options.dshPaths)
    } catch (error) {
      return finish({
        ok: false,
        error: thrownMessage(error),
        rebuildHelp: REBUILD_INSTRUCTIONS,
      })
    }
  }
  return finish(ensurePresetOverlay(dir, { personaConfig }))
}

/** @param {any} agentPresets @param {string} home @param {PresetCallOptions} [options] */
export async function seedVisionBenchPreset(agentPresets, home, options = {}) {
  const dir = userPresetDir(home)
  if (inFlightSeeds.has(dir)) {
    return inFlightSeeds.get(dir)
  }
  const promise = (async () => {
    try {
      return await _seedVisionBenchPresetInternal(agentPresets, home, dir, options)
    } finally {
      inFlightSeeds.delete(dir)
    }
  })()
  inFlightSeeds.set(dir, promise)
  return promise
}

export const _internal = {
  STANDARD_PERSONA,
  VISION_GUIDANCE,
  LEGACY_VISION_PERSONAS,
  OWNERSHIP_TEMPLATE,
  MARKER,
  REBUILD_INSTRUCTIONS,
  CORDIS_JS_TAG,
  parseCompositionDocument,
  checkOwnership,
  templateFieldsMatch,
  writeAtomic,
  copyDirRecursive,
  isVisionToolRow: (/** @type {unknown} */ id, /** @type {unknown} */ name) => isVisionToolRow(id, name, HOST_PLUGIN_NAME, AGENT_PLUGIN_SPEC),
}
