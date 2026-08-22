import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'yaml'

export const PRESET_ID = 'vision-bench'
export const PRESET_TITLE = 'Vision模式'
const MARKER = '.dsh-vision-bench'

export const STANDARD_PERSONA =
  'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.'

export const PRESET_PERSONA = STANDARD_PERSONA

export const VISION_GUIDANCE = [
  'Vision bench guidance (vision-bench:guidance):',
  '- Local bench is real or simulated; verify project/connection/device/point/value/frame/task via vision_bench tools with minimal queries.',
  '- Reference stable IDs (connectionId/deviceId/pointId) not UI focus; status→map only when needed.',
  '- HMI and Debug share live state; Agent actions must appear in tasks/timeline and page echoes.',
  '- Background reads must not steal focus; only explicit focus requests switch tabs.',
  '- Config changes produce draft + diff for user apply.',
  '- Writes/downloads/resets require approval with endpoint fingerprint and config version.',
  '- Diagnostics cite build log, point quality, frames, trend intervals or operation results.',
  '- Do not stream high-frequency values or bulk frames into system prompt.',
].join('\n')

const LEGACY_VISION_PERSONAS = [
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 ls/select/build/read。不要猜测用户选了哪个工程。',
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. '
    + '现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。'
    + 'write 是高影响操作：只按用户明确给出的地址和值写线圈或保持寄存器，写入后核对回读结果；用户没有明确要求时不要写点。',
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. '
    + '现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。',
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。',
]

export const PRESET_METADATA = [
  'name: ' + PRESET_TITLE,
  'description: 标准编码能力，外加 Vision 台架接口：查询现场工程、编译、Modbus 读点和受控写点。',
  '',
].join('\n')

const OWNERSHIP_TEMPLATE = {
  owner: 'dsh-vision-bench',
  presetSchemaVersion: 2,
  basePresetId: 'standard',
  pluginRowId: 'vision-bench-tools',
}

function writeOwnership(dir) {
  const markerPath = join(dir, MARKER)
  const payload = {
    ...OWNERSHIP_TEMPLATE,
    lastManagedAt: new Date().toISOString(),
  }
  writeFileSync(markerPath, JSON.stringify(payload, null, 2) + '\n')
  return payload
}

export const ensurePresetOverlay = (dir) => {
  const file = join(dir, 'agent.cordis.yml')
  if (!existsSync(file)) return { ok: false, error: 'missing composition' }
  const raw = readFileSync(file, 'utf8')
  let doc
  try {
    doc = yaml.parseDocument(raw)
  } catch (e) {
    return { ok: false, error: 'invalid yaml: ' + String(e && e.message || e) }
  }
  const seq = doc.contents
  if (!seq || !Array.isArray(seq.items)) {
    return { ok: false, error: 'invalid composition: expected sequence' }
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
      } catch {}
    } else if (!isStandard && !isLegacy && looksVision) {
      // Vision-like but not exact legacy => still treat as legacy to migrate? Better migrate exact only,
      // but this variant also contains Vision marker; we should not auto-overwrite if unknown user modification.
      // Check if it's exactly one of legacy: already false, so unknown -> needs review
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

  let nextText = String(doc.toString())
  if (!nextText.endsWith('\n')) nextText += '\n'

  const changed = nextText !== raw

  // If needsReview, we still write tool row/metadata/ownership but return diagnostic
  if (changed) {
    writeFileSync(file, nextText)
  }
  writeFileSync(join(dir, 'preset.yml'), PRESET_METADATA)
  writeOwnership(dir)

  if (needsReview) {
    return { ok: false, error: '预设需要人工检查', needsReview: true, dir, addedRow, personaNeedsReview: true }
  }
  return { ok: true, dir, addedRow }
}

export const userPresetDir = (home) => join(home, '.agent-presets', PRESET_ID)

export async function seedVisionBenchPreset(agentPresets, home) {
  const dir = userPresetDir(home)
  const composition = join(dir, 'agent.cordis.yml')
  const marker = join(dir, MARKER)
  const hasComposition = existsSync(composition)
  const hasMarker = existsSync(marker)
  if (hasComposition && !hasMarker) {
    return { ok: false, error: 'Vision预设 id 已被其他预设占用', dir }
  }
  if (hasComposition && hasMarker) {
    try {
      const raw = readFileSync(marker, 'utf8').trim()
      if (raw && raw !== 'dsh-vision-bench') {
        try {
          const obj = JSON.parse(raw)
          if (!obj || obj.owner !== 'dsh-vision-bench') {
            return { ok: false, error: 'Vision预设 id 已被其他预设占用', dir }
          }
        } catch {
          if (raw !== 'dsh-vision-bench') {
            return { ok: false, error: 'Vision预设 id 已被其他预设占用', dir }
          }
        }
      }
    } catch {}
  }
  if (!hasComposition && agentPresets && typeof agentPresets.copy === 'function') {
    try {
      await agentPresets.copy('standard', PRESET_ID, PRESET_TITLE)
    } catch {
      /* already exists, unknown source, or no writable root */
    }
  }
  if (!existsSync(composition)) {
    return { ok: false, error: '未能创建Vision预设（需要可从 standard 复制）' }
  }
  return ensurePresetOverlay(dir)
}

export const _internal = {
  STANDARD_PERSONA,
  VISION_GUIDANCE,
  LEGACY_VISION_PERSONAS,
  OWNERSHIP_TEMPLATE,
  MARKER,
}
