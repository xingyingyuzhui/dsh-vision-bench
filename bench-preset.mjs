import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as yaml from 'yaml'
import { LEGACY_VISION_PERSONAS, PRESET_PERSONA, STANDARD_PERSONA, VISION_GUIDANCE } from './bench-guidance.mjs'
import {
  loadOfficialPersonaConfig,
  localPersonaConfigReplica,
  resolveShippedStandardDir,
} from './src/infrastructure/harness/dsh-contract.mjs'
import {
  validateCompositionPersona,
  validateManagedVisionComposition,
  yamlNodeToPlain,
} from './src/infrastructure/harness/preset-validate.mjs'

// Every fs access goes through the same require cache as the test harness, so
// failures can be injected by patching node:fs (see test/tool-preset.test.mjs).
const _require = createRequire(import.meta.url)
const _readFileSync = (...a) => _require('node:fs').readFileSync(...a)
const _writeFileSync = (...a) => _require('node:fs').writeFileSync(...a)
const _copySync = (...a) => _require('node:fs').copyFileSync(...a)
const _renameSync = (...a) => _require('node:fs').renameSync(...a)
const _unlinkSync = (...a) => _require('node:fs').unlinkSync(...a)
const _mkdirSync = (...a) => _require('node:fs').mkdirSync(...a)
const _existsSync = (...a) => _require('node:fs').existsSync(...a)

export const PRESET_BACKUP_FAILED = 'PRESET_BACKUP_FAILED'
export const PRESET_WRITE_FAILED = 'PRESET_WRITE_FAILED'
export const PRESET_RESTORE_FAILED = 'PRESET_RESTORE_FAILED'

/**
 * Cordis stores JS expressions as `!!js …`. Overlay only needs to round-trip
 * the source text; evaluating it here would run untrusted preset YAML in-process.
 */
class CordisJsExpr {
  /** @param {string} src */
  constructor(src) {
    this.src = String(src ?? '')
  }
  toString() {
    return this.src
  }
}

const CORDIS_JS_TAG = {
  identify: (/** @type {unknown} */ value) => value instanceof CordisJsExpr,
  default: false,
  tag: 'tag:yaml.org,2002:js',
  /**
   * @param {string} value
   * @returns {CordisJsExpr}
   */
  resolve(value) {
    return new CordisJsExpr(value)
  },
  /**
   * @param {{ value?: unknown }} item
   */
  stringify(item) {
    const value = item && item.value
    return value instanceof CordisJsExpr ? value.src : String(value ?? '')
  },
}

/**
 * @param {string} raw
 */
export function parseCompositionDocument(raw) {
  return yaml.parseDocument(raw, { customTags: [CORDIS_JS_TAG], prettyErrors: true })
}

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

export const PRESET_ID = 'vision-bench'
export const PRESET_TITLE = 'Vision模式'
const MARKER = '.dsh-vision-bench'
const AFFECTED_FILES = ['agent.cordis.yml', 'preset.yml', MARKER]
const HOST_PLUGIN_NAME = 'dsh-vision-bench'

export { LEGACY_VISION_PERSONAS, PRESET_PERSONA, STANDARD_PERSONA, VISION_GUIDANCE }

/** Preset composition `name` — a package subpath, not the host plugin id. */
export const AGENT_PLUGIN_SPEC = 'dsh-vision-bench/agent'

export const PRESET_METADATA = [
  'name: ' + PRESET_TITLE,
  'description: 标准编码能力，外加 Vision 调试与上位机接口：查询现场工程、编译、Modbus 读点和受控写点。',
  '',
].join('\n')

const OWNERSHIP_TEMPLATE = {
  owner: 'dsh-vision-bench',
  presetSchemaVersion: 3,
  basePresetId: 'standard',
  pluginRowId: 'vision-bench-tools',
}

export const REBUILD_INSTRUCTIONS =
  '安全重建：备份 $DSH_HOME/.agent-presets/vision-bench 到带时间戳目录(.vision-bench.backup.<ISO>含 agent.cordis.yml/preset.yml/.dsh-vision-bench)，删除旧目录后 agentPresets.copy("standard","vision-bench","Vision模式")并重启'

// --- ownership marker -------------------------------------------------------
// Strict ownership check: an unreadable, empty, invalid-JSON or foreign marker
// fails closed — the caller must NOT proceed and overwrite it.
function checkOwnership(dir) {
  const markerPath = join(dir, MARKER)
  if (!_existsSync(markerPath)) return { exists: false }
  let raw
  try {
    raw = _readFileSync(markerPath, 'utf8').trim()
  } catch {
    return { exists: true, error: 'Vision预设 id 已被其他预设占用', reason: 'marker-unreadable' }
  }
  if (!raw) return { exists: true, error: 'Vision预设 id 已被其他预设占用', reason: 'marker-empty' }
  if (raw === 'dsh-vision-bench') return { exists: true, owned: true, legacy: true }
  let obj = null
  try {
    obj = JSON.parse(raw)
  } catch {
    /* invalid JSON fails closed below */
  }
  if (!obj || typeof obj !== 'object' || obj.owner !== 'dsh-vision-bench') {
    return { exists: true, error: 'Vision预设 id 已被其他预设占用', reason: 'marker-invalid-or-foreign' }
  }
  return { exists: true, owned: true, legacy: false, payload: obj }
}

// lastManagedAt is intentionally excluded: a fully consistent preset must not
// be rewritten just to refresh the timestamp.
function templateFieldsMatch(payload) {
  return (
    !!payload &&
    payload.owner === OWNERSHIP_TEMPLATE.owner &&
    payload.presetSchemaVersion === OWNERSHIP_TEMPLATE.presetSchemaVersion &&
    payload.basePresetId === OWNERSHIP_TEMPLATE.basePresetId &&
    payload.pluginRowId === OWNERSHIP_TEMPLATE.pluginRowId
  )
}

function ownershipText(nowIso) {
  return JSON.stringify({ ...OWNERSHIP_TEMPLATE, lastManagedAt: nowIso }, null, 2) + '\n'
}

// --- backup / atomic write / restore ---------------------------------------
// Task9/0.18.1: every existing file must back up successfully; any failure aborts.
// Returns a manifest { ok, backupDir, files }.
function createBackup(dir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(dirname(dir), `.${PRESET_ID}.backup.${timestamp}`)
  _mkdirSync(backupDir, { recursive: true })
  const files = []
  for (const name of AFFECTED_FILES) {
    const src = join(dir, name)
    if (_existsSync(src)) {
      try {
        _copySync(src, join(backupDir, name))
        files.push(name)
      } catch (e) {
        const err = new Error('复制备份失败 ' + name + ': ' + String((e && e.message) || e))
        err.backupDir = backupDir
        throw err
      }
    }
  }
  return { ok: true, backupDir, files }
}

// Atomic write: temp file in same dir + rename. On any failure the temp file
// is removed before the error propagates, so no partial file is left behind.
function writeAtomic(file, text, writeImpl) {
  const tmp = file + '.tmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const writer = writeImpl || _writeFileSync
  try {
    writer(tmp, text)
    _renameSync(tmp, file)
  } catch (e) {
    try {
      _unlinkSync(tmp)
    } catch {}
    throw e
  }
}

// Restore every file from backup; files that did not exist before are deleted.
function restoreAll(backupDir, dir, existedBefore) {
  for (const name of AFFECTED_FILES) {
    const target = join(dir, name)
    const src = join(backupDir, name)
    if (_existsSync(src)) {
      _copySync(src, target)
    } else if (!existedBefore[name] && _existsSync(target)) {
      _unlinkSync(target)
    }
  }
}

function yamlString(value) {
  return typeof value === 'string' ? value : undefined
}

function isVisionToolRow(id, name) {
  return id === 'vision-bench-tools' || name === HOST_PLUGIN_NAME || name === AGENT_PLUGIN_SPEC
}

function ensureYamlMap(doc, parent, key) {
  let node = typeof parent.get === 'function' ? parent.get(key) : undefined
  if (!node || typeof node.set !== 'function') {
    parent.set(key, doc.createNode({}))
    node = parent.get(key)
  }
  return node
}

function copyDirRecursive(src, dest) {
  _mkdirSync(dest, { recursive: true })
  const fs = _require('node:fs')
  const names = fs.readdirSync(src, { withFileTypes: true })
  for (const ent of names) {
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) copyDirRecursive(from, to)
    else if (!_existsSync(to)) _copySync(from, to)
  }
}

function isAlreadyExistsError(error) {
  const code = error && typeof error === 'object' ? error.code : ''
  const msg = String((error && error.message) || error || '')
  return code === 'agent-preset/invalid' && /already exists/.test(msg)
}

export const ensurePresetOverlay = (dir, options = {}) => {
  const personaConfig = options.personaConfig || localPersonaConfigReplica
  const file = join(dir, 'agent.cordis.yml')
  if (!_existsSync(file)) return { ok: false, error: 'missing composition' }
  const raw = _readFileSync(file, 'utf8')
  let doc
  try {
    doc = parseCompositionDocument(raw)
  } catch (e) {
    return { ok: false, error: 'invalid yaml: ' + String((e && e.message) || e), rebuildHelp: REBUILD_INSTRUCTIONS }
  }
  if (doc.errors && doc.errors.length) {
    return {
      ok: false,
      error: 'invalid yaml: ' + String(doc.errors[0].message || doc.errors[0]),
      hasYamlError: true,
      rebuildHelp: REBUILD_INSTRUCTIONS,
    }
  }
  const seq = doc.contents
  if (!seq || !Array.isArray(seq.items)) {
    return { ok: false, error: 'invalid composition: expected sequence', rebuildHelp: REBUILD_INSTRUCTIONS }
  }

  // only manage ownership-declared nodes; invalid/foreign markers fail closed
  const ownership = checkOwnership(dir)
  if (ownership.error) {
    return { ok: false, error: ownership.error, dir, rebuildHelp: REBUILD_INSTRUCTIONS }
  }

  let personaNode = null
  const toolRows = []
  for (const item of seq.items) {
    if (!item || typeof item.get !== 'function') continue
    const id = item.get('id')
    const name = item.get('name')
    if (id === 'persona' || (typeof name === 'string' && name.includes('dsh-persona'))) personaNode = item
    if (isVisionToolRow(id, name)) toolRows.push(item)
  }

  let needsReview = false
  let personaRestored = false
  let personaConflict = false
  if (personaNode && typeof personaNode.get === 'function') {
    try {
      const cfg = ensureYamlMap(doc, personaNode, 'config')
      const prefix = yamlString(cfg.get('prefix'))
      const text = yamlString(cfg.get('text'))
      if (prefix && text && prefix.trim() !== text.trim()) {
        personaConflict = true
        needsReview = true
      } else if (prefix && text && typeof cfg.delete === 'function') {
        cfg.delete('text')
      } else if (!prefix && typeof text === 'string') {
        const cur = text.trim()
        const isStandard = cur === STANDARD_PERSONA.trim()
        const isLegacy = LEGACY_VISION_PERSONAS.some((p) => p.trim() === cur)
        const looksVision = cur.includes('Vision 台架') || cur.includes('Vision 台架 agent')
        const next = isLegacy ? STANDARD_PERSONA : text
        cfg.set('prefix', next)
        if (typeof cfg.delete === 'function') cfg.delete('text')
        if (isLegacy) personaRestored = true
        else if (!isStandard) needsReview = true
        if (looksVision && !isLegacy && !isStandard) needsReview = true
      }
    } catch (e) {
      return {
        ok: false,
        error: ' persona 迁移失败：' + String((e && e.message) || e),
        needsReview: true,
        dir,
        rebuildHelp: REBUILD_INSTRUCTIONS,
      }
    }
  }

  let addedRow = false
  const keep = toolRows[0]
  if (keep && typeof keep.set === 'function') {
    keep.set('id', 'vision-bench-tools')
    keep.set('name', AGENT_PLUGIN_SPEC)
    const cfg = keep.get('config')
    if (cfg && typeof cfg.delete === 'function') {
      cfg.delete('role')
      const plain = yamlNodeToPlain(cfg)
      if (Object.keys(plain).length === 0 && typeof keep.delete === 'function') keep.delete('config')
    }
  } else {
    seq.items.push(doc.createNode({ id: 'vision-bench-tools', name: AGENT_PLUGIN_SPEC }))
    addedRow = true
  }
  for (let i = toolRows.length - 1; i >= 1; i--) {
    const extra = toolRows[i]
    const idx = seq.items.indexOf(extra)
    if (idx >= 0) seq.items.splice(idx, 1)
  }

  const personaCheck = validateCompositionPersona(seq, personaConfig)
  if (!personaCheck.ok) {
    return {
      ok: false,
      error: personaCheck.error,
      dir,
      rebuildHelp: REBUILD_INSTRUCTIONS,
    }
  }

  // Desired contents for all three files, computed up-front and compared with
  // the current content — a file is only written when its content would change.
  const desiredComposition = (() => {
    let t = String(doc.toString())
    if (!t.endsWith('\n')) t += '\n'
    return t
  })()
  const desiredPresetMetadata = PRESET_METADATA
  const compositionChanged = desiredComposition !== raw
  let metadataChanged = true
  try {
    metadataChanged = _readFileSync(join(dir, 'preset.yml'), 'utf8') !== desiredPresetMetadata
  } catch {
    /* missing/unreadable preset.yml needs a write */
  }

  // The marker only gains a fresh lastManagedAt when an actual migration or
  // version change happens; a fully consistent preset is left byte-identical
  // (no backup, no writes) so repeated startups stay quiet.
  const markerChanged =
    !ownership.exists ||
    ownership.legacy ||
    !templateFieldsMatch(ownership.payload) ||
    compositionChanged ||
    metadataChanged
  const willWrite = compositionChanged || metadataChanged || markerChanged

  if (!willWrite) {
    if (needsReview) {
      return {
        ok: false,
        error: personaConflict ? 'persona 同时存在冲突的 prefix 与 text，已保留 prefix' : '预设需要人工检查',
        needsReview: true,
        dir,
        personaNeedsReview: true,
        personaConflict,
        unchanged: true,
        rebuildHelp: REBUILD_INSTRUCTIONS,
      }
    }
    return { ok: true, dir, unchanged: true }
  }

  // Backup before any write that would modify existing files. Any backup
  // failure aborts immediately with PRESET_BACKUP_FAILED.
  let backupDir = null
  try {
    const bak = createBackup(dir)
    backupDir = bak.backupDir
  } catch (e) {
    return {
      ok: false,
      error: '预设备份失败：' + String((e && e.message) || e),
      errorCode: PRESET_BACKUP_FAILED,
      needsReview: true,
      backupDir: (e && e.backupDir) || null,
      rebuildHelp: REBUILD_INSTRUCTIONS,
    }
  }

  // remember which affected files existed before the write (for rollback of
  // newly-created copies)
  const existedBefore = {}
  for (const n of AFFECTED_FILES) existedBefore[n] = _existsSync(join(dir, n))

  try {
    if (compositionChanged) writeAtomic(file, desiredComposition)
    if (metadataChanged) writeAtomic(join(dir, 'preset.yml'), desiredPresetMetadata)
    if (markerChanged) writeAtomic(join(dir, MARKER), ownershipText(new Date().toISOString()))
  } catch (e) {
    // rollback ALL affected files; failure to roll back is a distinct error
    let restoreErr = null
    try {
      restoreAll(backupDir, dir, existedBefore)
    } catch (re) {
      restoreErr = String((re && re.message) || re)
    }
    if (restoreErr) {
      return {
        ok: false,
        error: '预设写入失败且回滚失败：' + String((e && e.message) || e) + ' / ' + restoreErr,
        errorCode: PRESET_RESTORE_FAILED,
        backupDir,
        needsReview: true,
        rebuildHelp: REBUILD_INSTRUCTIONS,
      }
    }
    return {
      ok: false,
      error: '预设写入失败：' + String((e && e.message) || e),
      errorCode: PRESET_WRITE_FAILED,
      backupDir,
      needsReview: true,
      rebuildHelp: REBUILD_INSTRUCTIONS,
    }
  }

  if (needsReview) {
    return {
      ok: false,
      error: personaConflict ? 'persona 同时存在冲突的 prefix 与 text，已保留 prefix' : '预设需要人工检查',
      needsReview: true,
      dir,
      addedRow,
      personaNeedsReview: true,
      personaConflict,
      backupDir,
      rebuildHelp: REBUILD_INSTRUCTIONS,
    }
  }
  return { ok: true, dir, addedRow, backupDir, personaRestored }
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
  isVisionToolRow,
}
