import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as yaml from 'yaml'

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

export const PRESET_ID = 'vision-bench'
export const PRESET_TITLE = 'Vision模式'
const MARKER = '.dsh-vision-bench'
const AFFECTED_FILES = ['agent.cordis.yml', 'preset.yml', MARKER]

export const STANDARD_PERSONA =
  'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.'

export const PRESET_PERSONA = STANDARD_PERSONA

export const VISION_GUIDANCE = [
  'Vision bench guidance (vision-bench:guidance):',
  '- Local bench is real or simulated; verify project/connection/device/point/value/frame/task via vision_bench tools with minimal queries.',
  '- Reference stable IDs (connectionId/deviceId/pointId) not UI focus; status→map only when needed.',
  '- HMI and Debug share live state; Agent actions must appear in tasks/timeline and page echoes.',
  '- Background reads must not steal focus; only explicit focus requests switch tabs.',
  '- Agent 可以直接修改连接、设备、点位和可视化配置。',
  '- 配置修改必须携带当前 configVersion，Host 校验后原子保存并记录操作。',
  '- 真实设备写入和烧录仍需要用户批准。',
  '- Writes/downloads/resets require approval with endpoint fingerprint and config version.',
  '- Diagnostics cite build log, point quality, frames (transactionId), trend intervals or operation results.',
  '- Do not stream high-frequency values or bulk frames into system prompt.',
  '- Modbus TCP/RTU and raw serial use the bundled Node runtime; they do not require Python.',
  '- WRITE_OUTCOME_UNKNOWN means the write may have executed; do not retry. Read the address first and wait for the user to re-approve.',
  '- TCP frames are protocol-normalized, not raw MBAP.',
  '- Use an existing HMI serial connection. If it is disconnected, call connect first. Never open a second serial port just to view frames; TX/RX from user, polling and Agent I/O already appear on the frames page.',
  '- Points have two independent switches: monitorEnabled (visualization data source; enable it then associate the point in a visualization component) and alarmEnabled (threshold alarms). Never conflate them.',
  '- Visualization components are read via action=visualization (list/get) and mutated via add/update/remove. Old propose* ops return OP_REMOVED.',
  '- Switch component writes are high-impact: they still require user confirmation and readback, exactly like point writes.',
].join('\n')

const LEGACY_VISION_PERSONAS = [
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 ls/select/build/read。不要猜测用户选了哪个工程。',
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. ' +
    '现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。' +
    'write 是高影响操作：只按用户明确给出的地址和值写线圈或保持寄存器，写入后核对回读结果；用户没有明确要求时不要写点。',
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. ' +
    '现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。',
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。',
]

export const PRESET_METADATA = [
  'name: ' + PRESET_TITLE,
  'description: 标准编码能力，外加 Vision 调试与上位机接口：查询现场工程、编译、Modbus 读点和受控写点。',
  '',
].join('\n')

const OWNERSHIP_TEMPLATE = {
  owner: 'dsh-vision-bench',
  presetSchemaVersion: 2,
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

export const ensurePresetOverlay = (dir) => {
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

  // Locate tool row via YAML Document API (id: vision-bench-tools)
  let hadRow = false
  let personaNode = null
  let personaText = null
  for (const item of seq.items) {
    if (!item || typeof item.get !== 'function') continue
    const id = item.get('id')
    if (id === 'vision-bench-tools') hadRow = true
    if (id === 'persona') {
      personaNode = item
      try {
        const t = item.getIn(['config', 'text'])
        if (typeof t === 'string') personaText = t
        else {
          const cfg = item.get('config')
          if (cfg && typeof cfg.get === 'function') {
            const v = cfg.get('text')
            if (typeof v === 'string') personaText = v
          }
        }
      } catch {}
    }
  }

  let needsReview = false
  let personaRestored = false
  if (personaNode && typeof personaText === 'string') {
    const cur = personaText.trim()
    const isStandard = cur === STANDARD_PERSONA.trim()
    const isLegacy = LEGACY_VISION_PERSONAS.some((p) => p.trim() === cur)
    const looksVision = cur.includes('Vision 台架') || cur.includes('Vision 台架 agent')
    if (!isStandard && isLegacy) {
      // Known legacy: restore to standard, Vision rules now via plugin guidance
      try {
        const cfg = personaNode.get('config')
        if (cfg && typeof cfg.set === 'function') {
          cfg.set('text', STANDARD_PERSONA)
        } else if (personaNode.setIn) {
          personaNode.setIn(['config', 'text'], STANDARD_PERSONA)
        }
        personaRestored = true
      } catch (e) {
        return {
          ok: false,
          error: ' persona 迁移失败：' + String((e && e.message) || e),
          needsReview: true,
          dir,
          rebuildHelp: REBUILD_INSTRUCTIONS,
        }
      }
    } else if (!isStandard && !isLegacy && looksVision) {
      needsReview = true
    } else if (!isStandard && !isLegacy) {
      // Completely unknown persona: user-modified
      needsReview = true
    }
  }

  // Ensure tool row idempotently
  let addedRow = false
  if (!hadRow) {
    const toolObj = {
      id: 'vision-bench-tools',
      name: 'dsh-vision-bench',
      config: { role: 'agent' },
    }
    const node = doc.createNode(toolObj)
    seq.items.push(node)
    addedRow = true
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
        error: '预设需要人工检查',
        needsReview: true,
        dir,
        personaNeedsReview: true,
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
      error: '预设需要人工检查',
      needsReview: true,
      dir,
      addedRow,
      personaNeedsReview: true,
      backupDir,
      rebuildHelp: REBUILD_INSTRUCTIONS,
    }
  }
  return { ok: true, dir, addedRow, backupDir, personaRestored }
}

export const userPresetDir = (home) => join(home, '.agent-presets', PRESET_ID)

export async function seedVisionBenchPreset(agentPresets, home) {
  const dir = userPresetDir(home)
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
  if (!hasComposition && agentPresets && typeof agentPresets.copy === 'function') {
    try {
      await agentPresets.copy('standard', PRESET_ID, PRESET_TITLE)
    } catch {
      /* already exists, unknown source, or no writable root */
    }
  }
  if (!_existsSync(composition)) {
    return finish({
      ok: false,
      error: '未能创建Vision预设（需要可从 standard 复制）',
      rebuildHelp: REBUILD_INSTRUCTIONS,
    })
  }
  return finish(ensurePresetOverlay(dir))
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
}
