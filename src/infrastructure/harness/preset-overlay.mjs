import { join } from 'node:path'
import * as yaml from 'yaml'
import { LEGACY_VISION_PERSONAS, STANDARD_PERSONA } from './guidance.mjs'
import { localPersonaConfigReplica } from './dsh-contract.mjs'
import { validateCompositionPersona, yamlNodeToPlain } from './preset-validate.mjs'
import {
  AFFECTED_FILES,
  MARKER,
  PRESET_BACKUP_FAILED,
  PRESET_RESTORE_FAILED,
  PRESET_WRITE_FAILED,
  _existsSync,
  _readFileSync,
  createBackup,
  restoreAll,
  writeAtomic,
} from './preset-transaction.mjs'

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

export const CORDIS_JS_TAG = {
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

export const OWNERSHIP_TEMPLATE = {
  owner: 'dsh-vision-bench',
  presetSchemaVersion: 3,
  basePresetId: 'standard',
  pluginRowId: 'vision-bench-tools',
}

/**
 * Strict ownership check: an unreadable, empty, invalid-JSON or foreign marker
 * fails closed — the caller must NOT proceed and overwrite it.
 * @param {string} dir
 */
export function checkOwnership(dir) {
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
export function templateFieldsMatch(payload) {
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

function yamlString(value) {
  return typeof value === 'string' ? value : undefined
}

/**
 * @param {unknown} id
 * @param {unknown} name
 * @param {string} hostPluginName
 * @param {string} agentPluginSpec
 */
export function isVisionToolRow(id, name, hostPluginName, agentPluginSpec) {
  return id === 'vision-bench-tools' || name === hostPluginName || name === agentPluginSpec
}

/** @deprecated Removed in DSH 0.1.6-alpha; standard now ships `dsh-workflow-ptc`. */
const OBSOLETE_WORKFLOW_WORKER = '@deepseek-ai/dsh-workflow-worker-thread'
const CURRENT_WORKFLOW_PTC = '@deepseek-ai/dsh-workflow-ptc'

/**
 * Walk a Cordis composition sequence (including nested `cordis:group` config lists)
 * and rewrite obsolete workflow-worker-thread rows to workflow-ptc.
 * @param {any} seq YAML sequence node with `.items`
 * @returns {boolean} whether any node was rewritten
 */
export function migrateObsoleteWorkflowWorkerRows(seq) {
  if (!seq || !Array.isArray(seq.items)) return false
  let changed = false
  const visit = (items) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (!item || typeof item.get !== 'function') continue
      const id = item.get('id')
      const name = item.get('name')
      if (
        id === 'workflow-worker-thread' ||
        name === OBSOLETE_WORKFLOW_WORKER ||
        (typeof name === 'string' && name.includes('dsh-workflow-worker-thread'))
      ) {
        if (typeof item.set === 'function') {
          item.set('id', 'workflow-ptc')
          item.set('name', CURRENT_WORKFLOW_PTC)
          changed = true
        }
      }
      // `cordis:group` uses `config:` as a YAML sequence of child plugin rows.
      if (name === 'cordis:group' || name === 'cordis:plugin-group') {
        const cfg = item.get('config')
        if (cfg && Array.isArray(cfg.items)) visit(cfg.items)
        else if (cfg && typeof cfg.get === 'function') {
          const plugins = cfg.get('plugins')
          if (plugins && Array.isArray(plugins.items)) visit(plugins.items)
        }
      }
    }
  }
  visit(seq.items)
  return changed
}

function ensureYamlMap(doc, parent, key) {
  let node = typeof parent.get === 'function' ? parent.get(key) : undefined
  if (!node || typeof node.set !== 'function') {
    parent.set(key, doc.createNode({}))
    node = parent.get(key)
  }
  return node
}

/**
 * @param {string} dir
 * @param {{
 *   personaConfig?: any,
 *   presetId: string,
 *   presetMetadata: string,
 *   agentPluginSpec: string,
 *   hostPluginName: string,
 *   rebuildInstructions: string,
 * }} options
 */
export const ensurePresetOverlay = (dir, options) => {
  const personaConfig = options.personaConfig || localPersonaConfigReplica
  const {
    presetId,
    presetMetadata,
    agentPluginSpec,
    hostPluginName,
    rebuildInstructions,
  } = options
  const file = join(dir, 'agent.cordis.yml')
  if (!_existsSync(file)) return { ok: false, error: 'missing composition' }
  const raw = _readFileSync(file, 'utf8')
  let doc
  try {
    doc = parseCompositionDocument(raw)
  } catch (e) {
    return { ok: false, error: 'invalid yaml: ' + String((e && e.message) || e), rebuildHelp: rebuildInstructions }
  }
  if (doc.errors && doc.errors.length) {
    return {
      ok: false,
      error: 'invalid yaml: ' + String(doc.errors[0].message || doc.errors[0]),
      hasYamlError: true,
      rebuildHelp: rebuildInstructions,
    }
  }
  const seq = doc.contents
  if (!seq || !Array.isArray(seq.items)) {
    return { ok: false, error: 'invalid composition: expected sequence', rebuildHelp: rebuildInstructions }
  }

  migrateObsoleteWorkflowWorkerRows(seq)

  const ownership = checkOwnership(dir)
  if (ownership.error) {
    return { ok: false, error: ownership.error, dir, rebuildHelp: rebuildInstructions }
  }

  let personaNode = null
  const toolRows = []
  for (const item of seq.items) {
    if (!item || typeof item.get !== 'function') continue
    const id = item.get('id')
    const name = item.get('name')
    if (id === 'persona' || (typeof name === 'string' && name.includes('dsh-persona'))) personaNode = item
    if (isVisionToolRow(id, name, hostPluginName, agentPluginSpec)) toolRows.push(item)
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
        rebuildHelp: rebuildInstructions,
      }
    }
  }

  let addedRow = false
  const keep = toolRows[0]
  if (keep && typeof keep.set === 'function') {
    keep.set('id', 'vision-bench-tools')
    keep.set('name', agentPluginSpec)
    const cfg = keep.get('config')
    if (cfg && typeof cfg.delete === 'function') {
      cfg.delete('role')
      const plain = yamlNodeToPlain(cfg)
      if (Object.keys(plain).length === 0 && typeof keep.delete === 'function') keep.delete('config')
    }
  } else {
    seq.items.push(doc.createNode({ id: 'vision-bench-tools', name: agentPluginSpec }))
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
      rebuildHelp: rebuildInstructions,
    }
  }

  const desiredComposition = (() => {
    let t = String(doc.toString())
    if (!t.endsWith('\n')) t += '\n'
    return t
  })()
  const desiredPresetMetadata = presetMetadata
  const compositionChanged = desiredComposition !== raw
  let metadataChanged = true
  try {
    metadataChanged = _readFileSync(join(dir, 'preset.yml'), 'utf8') !== desiredPresetMetadata
  } catch {
    /* missing/unreadable preset.yml needs a write */
  }

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
        rebuildHelp: rebuildInstructions,
      }
    }
    return { ok: true, dir, unchanged: true }
  }

  let backupDir = null
  try {
    const bak = createBackup(dir, presetId)
    backupDir = bak.backupDir
  } catch (e) {
    return {
      ok: false,
      error: '预设备份失败：' + String((e && e.message) || e),
      errorCode: PRESET_BACKUP_FAILED,
      needsReview: true,
      backupDir: (e && e.backupDir) || null,
      rebuildHelp: rebuildInstructions,
    }
  }

  const existedBefore = {}
  for (const n of AFFECTED_FILES) existedBefore[n] = _existsSync(join(dir, n))

  try {
    if (compositionChanged) writeAtomic(file, desiredComposition)
    if (metadataChanged) writeAtomic(join(dir, 'preset.yml'), desiredPresetMetadata)
    if (markerChanged) writeAtomic(join(dir, MARKER), ownershipText(new Date().toISOString()))
  } catch (e) {
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
        rebuildHelp: rebuildInstructions,
      }
    }
    return {
      ok: false,
      error: '预设写入失败：' + String((e && e.message) || e),
      errorCode: PRESET_WRITE_FAILED,
      backupDir,
      needsReview: true,
      rebuildHelp: rebuildInstructions,
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
      rebuildHelp: rebuildInstructions,
    }
  }
  return { ok: true, dir, addedRow, backupDir, personaRestored }
}
