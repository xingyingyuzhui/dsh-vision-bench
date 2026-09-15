import { join } from 'node:path'
import { LEGACY_VISION_PERSONAS, PRESET_PERSONA, STANDARD_PERSONA, VISION_GUIDANCE } from './guidance.mjs'
import {
  loadOfficialPersonaConfig,
  resolveShippedStandardDir,
} from './dsh-contract.mjs'
import { validateManagedVisionComposition } from './preset-validate.mjs'
import {
  MARKER,
  PRESET_BACKUP_FAILED,
  PRESET_RESTORE_FAILED,
  PRESET_WRITE_FAILED,
  _existsSync,
  _readFileSync,
  copyDirRecursive,
  isAlreadyExistsError,
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

/** @type {{ ok: boolean, error?: string }} */
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

export const PRESET_ID = 'vision-bench'
export const PRESET_TITLE = 'Vision模式'
const HOST_PLUGIN_NAME = 'dsh-vision-bench'

export { LEGACY_VISION_PERSONAS, PRESET_PERSONA, STANDARD_PERSONA, VISION_GUIDANCE }

/** Preset composition `name` — a package subpath, not the host plugin id. */
export const AGENT_PLUGIN_SPEC = 'dsh-vision-bench/agent'

export const PRESET_METADATA = [
  'name: ' + PRESET_TITLE,
  'description: 标准编码能力，外加 Vision 调试与上位机接口：查询现场工程、编译、Modbus 读点和受控写点。',
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

export async function inspectPresetHealth(home, options = {}) {
  const seed = getLastPresetSeed()
  const dir = userPresetDir(home)
  const composition = join(dir, 'agent.cordis.yml')
  const ownership = _existsSync(dir) ? checkOwnership(dir) : { exists: false }
  const generation = ownership.payload && ownership.payload.lastManagedAt ? String(ownership.payload.lastManagedAt) : ''
  const fail = (error) => ({
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
        const contract = validateManagedVisionComposition(parsed.contents, personaConfig)
        if (!contract.ok) parseError = contract.error
      }
    } catch (error) {
      parseError = String((error && error.message) || error)
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

export const userPresetDir = (home) => join(home, '.agent-presets', PRESET_ID)

const inFlightSeeds = new Map()

async function copyStandardSource(agentPresets, dir, options) {
  if (agentPresets && typeof agentPresets.copy === 'function') {
    try {
      await agentPresets.copy('standard', PRESET_ID, PRESET_TITLE)
      return { ok: true, via: 'agentPresets.copy' }
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        return {
          ok: false,
          error: '从 standard 复制失败：' + String((error && error.message) || error),
        }
      }
    }
  }
  let standardDir
  try {
    standardDir = resolveShippedStandardDir(options.standardDir, options.dshPaths)
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
  if (!_existsSync(standardDir)) {
    return { ok: false, error: '找不到 DSH standard 预设: ' + standardDir }
  }
  try {
    copyDirRecursive(standardDir, dir)
    return { ok: true, via: 'shipped-standard', standardDir }
  } catch (error) {
    return { ok: false, error: '复制 shipped standard 失败：' + String((error && error.message) || error) }
  }
}

async function _seedVisionBenchPresetInternal(agentPresets, home, dir, options) {
  const composition = join(dir, 'agent.cordis.yml')
  const marker = join(dir, MARKER)
  const finish = (result) => {
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
        error: String((error && error.message) || error),
        rebuildHelp: REBUILD_INSTRUCTIONS,
      })
    }
  }
  return finish(ensurePresetOverlay(dir, { personaConfig }))
}

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
  isVisionToolRow: (id, name) => isVisionToolRow(id, name, HOST_PLUGIN_NAME, AGENT_PLUGIN_SPEC),
}
