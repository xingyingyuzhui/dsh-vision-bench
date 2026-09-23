import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STANDARD_PRESET_SNAPSHOT_CONTRACT,
  buildStandardPresetChildren,
} from '../../src/infrastructure/harness/standard-preset-snapshot.mjs'

test('snapshot tracks the pinned DSH contract', () => {
  assert.equal(STANDARD_PRESET_SNAPSHOT_CONTRACT, '0.1.7-alpha.2')
})

test('snapshot carries the full shipped standard child list in order', () => {
  const ids = buildStandardPresetChildren({ platform: 'linux' }).map((row) => row.id)
  assert.deepEqual(ids, [
    'persona',
    'agent-instructions',
    'tool-bash',
    'tool-pwsh',
    'tool-fs',
    'tool-fs-search',
    'tool-jobs',
    'skill-filesystem',
    'tool-skill',
    'command-goal',
    'tool-goal',
    'planning',
    'compaction',
    'delegation',
    'tool-ask-user',
    'tool-todo',
    'tool-web',
    'present',
    'tool-plugin-manager',
  ])
})

test('snapshot never carries the Vision tool row', () => {
  const rows = buildStandardPresetChildren({ platform: 'linux' })
  assert.ok(!rows.some((row) => row.id === 'vision-bench-tools'))
  assert.ok(!rows.some((row) => row.name === 'dsh-vision-bench/agent'))
})

test('snapshot keeps always-off providers disabled', () => {
  const rows = buildStandardPresetChildren({ platform: 'linux' })
  const delegation = /** @type {{ config: any[] }} */ (rows.find((row) => row.id === 'delegation'))
  const off = delegation.config.filter((row) => row.disabled === true).map((row) => row.id)
  assert.deepEqual(off.sort(), ['tool-ralph', 'tool-subagent-claude-code', 'tool-subagent-codex'])
  assert.equal(rows.find((row) => row.id === 'tool-plugin-manager')?.disabled, true)
})
