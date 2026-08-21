import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PRESET_ID = 'vision-bench'
export const PRESET_TITLE = '台架模式'
const MARKER = '.dsh-vision-bench'

export const PRESET_PERSONA =
  'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. '
  + '现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 ls/select/build/read。不要猜测用户选了哪个工程。'

const TOOL_ROW = [
  '',
  '# ── Vision 台架 ──────────────────────────────────────────────────────────',
  '- id: vision-bench-tools',
  '  name: dsh-vision-bench',
  '  config:',
  '    role: agent',
  '',
].join('\n')

export const PRESET_METADATA = [
  'name: ' + PRESET_TITLE,
  'description: 标准编码能力，外加 Vision 台架接口：查询现场工程、编译、Modbus 读点。',
  '',
].join('\n')

export const ensurePresetOverlay = (dir) => {
  const file = join(dir, 'agent.cordis.yml')
  if (!existsSync(file)) return { ok: false, error: 'missing composition' }
  let text = readFileSync(file, 'utf8')
  const hadRow = text.indexOf('id: vision-bench-tools') >= 0
  if (!hadRow) text = text.replace(/\s*$/, '') + '\n' + TOOL_ROW
  const codingPersona = 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.'
  if (text.indexOf(codingPersona) >= 0) {
    text = text.split(codingPersona).join(PRESET_PERSONA)
  }
  writeFileSync(file, text)
  writeFileSync(join(dir, 'preset.yml'), PRESET_METADATA)
  writeFileSync(join(dir, MARKER), 'dsh-vision-bench\n')
  return { ok: true, dir, addedRow: !hadRow }
}

export const userPresetDir = (home) => join(home, '.agent-presets', PRESET_ID)

export async function seedVisionBenchPreset(agentPresets, home) {
  if (agentPresets && typeof agentPresets.copy === 'function') {
    try {
      await agentPresets.copy('standard', PRESET_ID, PRESET_TITLE)
    } catch {
      /* already exists, unknown source, or no writable root */
    }
  }
  const dir = userPresetDir(home)
  if (!existsSync(join(dir, 'agent.cordis.yml'))) {
    return { ok: false, error: '未能创建台架预设（需要可从 standard 复制）' }
  }
  return ensurePresetOverlay(dir)
}
