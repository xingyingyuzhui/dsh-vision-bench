import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  AGENT_PLUGIN_SPEC,
  PRESET_PERSONA,
  _internal,
  ensurePresetOverlay,
  inspectPresetHealth,
  parseCompositionDocument,
  seedVisionBenchPreset,
} from '../../bench-preset.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'
import { LEGACY_PERSONA_A, personaComposition, trackBackup, withFsPatched } from '../helpers/preset-fixtures.mjs'

test('ensurePresetOverlay migrates obsolete workflow-worker-thread to workflow-ptc', async (t) => {
  const dir = await createTempDir(t, 'dvb-preset-workflow-')
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: hello',
      '- id: tools-group',
      '  name: cordis:group',
      '  config:',
      '    - id: workflow-worker-thread',
      "      name: '@deepseek-ai/dsh-workflow-worker-thread'",
      '      config:',
      '        provider: spawn',
      '    - id: tool-workflow',
      "      name: '@deepseek-ai/dsh-tool-workflow'",
      '',
    ].join('\n'),
  )
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({
      owner: 'dsh-vision-bench',
      presetSchemaVersion: 3,
      basePresetId: 'standard',
      pluginRowId: 'vision-bench-tools',
    }),
  )
  const out = ensurePresetOverlay(dir)
  assert.equal(out.ok, true, out.error)
  const text = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.match(text, /id: workflow-ptc/)
  assert.match(text, /@deepseek-ai\/dsh-workflow-ptc/)
  assert.doesNotMatch(text, /workflow-worker-thread/)
  assert.doesNotMatch(text, /dsh-workflow-worker-thread/)
})
