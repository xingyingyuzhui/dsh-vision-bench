#!/usr/bin/env node
import { seedVisionBenchPreset } from '../bench-preset.mjs'
import { defaultDshHome } from '../src/infrastructure/store/dsh-home.mjs'

const home = defaultDshHome()
const out = await seedVisionBenchPreset(null, home)
if (!out || out.ok === false) {
  console.error('[dsh-vision-bench] Vision预设未更新:', (out && out.error) || 'overlay failed')
  if (out && out.rebuildHelp) console.error(out.rebuildHelp)
  process.exit(1)
}
console.log('[dsh-vision-bench] Vision预设', out.unchanged ? '已是最新' : '已写入', out.dir || '')
