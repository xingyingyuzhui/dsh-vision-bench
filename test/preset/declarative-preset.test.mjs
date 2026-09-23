import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_PLUGIN_SPEC,
  PRESET_DESCRIPTION,
  PRESET_ID,
  PRESET_ORDER,
  PRESET_TITLE,
  buildVisionPresetDefinition,
  isDeclarativeRegistry,
  isDuplicatePresetError,
} from '../../src/infrastructure/harness/preset-declaration.mjs'
import { buildStandardPresetChildren } from '../../src/infrastructure/harness/standard-preset-snapshot.mjs'

const flatten = (rows) => rows.flatMap((row) => (Array.isArray(row.config) ? [row, ...flatten(row.config)] : [row]))

test('vision declaration restates standard children and appends one agent tool row', () => {
  const definition = buildVisionPresetDefinition({ platform: 'linux' })
  assert.equal(definition.id, PRESET_ID)
  assert.equal(definition.name, PRESET_TITLE)
  assert.equal(definition.description, PRESET_DESCRIPTION)
  assert.equal(definition.order, PRESET_ORDER)

  const rows = flatten(definition.plugins)
  const toolRows = rows.filter((row) => row.id === 'vision-bench-tools' || row.name === AGENT_PLUGIN_SPEC)
  assert.equal(toolRows.length, 1)
  assert.deepEqual(toolRows[0], { id: 'vision-bench-tools', name: AGENT_PLUGIN_SPEC })

  const standard = buildStandardPresetChildren({ platform: 'linux' })
  assert.equal(definition.plugins.length, standard.length + 1)
  assert.deepEqual(definition.plugins.slice(0, standard.length), standard)
  assert.equal(definition.plugins[standard.length], toolRows[0])
})

test('persona row keeps the shipped prefix/suffix split', () => {
  const [persona] = buildVisionPresetDefinition({ platform: 'linux' }).plugins
  assert.equal(persona.id, 'persona')
  assert.equal(persona.name, '@deepseek-ai/dsh-persona')
  assert.equal(typeof persona.config, 'object')
  const config = /** @type {Record<string, unknown>} */ (persona.config)
  assert.match(String(config.prefix), /\{\{model\}\}/)
  assert.match(String(config.suffix), /\{\{cwd\}\}/)
})

test('!!js platform rows arrive as plain booleans', () => {
  const rows = flatten(buildVisionPresetDefinition({ platform: 'win32' }).plugins)
  const bash = rows.find((row) => row.id === 'tool-bash')
  const pwsh = rows.find((row) => row.id === 'tool-pwsh')
  assert.equal(bash?.disabled, true)
  assert.equal(pwsh?.disabled, false)
  const posix = flatten(buildVisionPresetDefinition({ platform: 'linux' }).plugins)
  assert.equal(posix.find((row) => row.id === 'tool-bash')?.disabled, false)
  assert.equal(posix.find((row) => row.id === 'tool-pwsh')?.disabled, true)
})

test('group rows keep their isolate realms and nested children', () => {
  const groups = buildVisionPresetDefinition({ platform: 'linux' }).plugins.filter((row) => row.group === true)
  const byId = new Map(groups.map((row) => [row.id, row]))
  assert.deepEqual(byId.get('planning')?.isolate, { planMode: true })
  assert.deepEqual(byId.get('compaction')?.isolate, { compaction: true, toolResultPruner: true })
  assert.deepEqual(byId.get('delegation')?.isolate, { workflowEngine: true })
  const delegation = /** @type {{ config: any[] }} */ (byId.get('delegation'))
  assert.ok(delegation.config.some((row) => row.id === 'tool-subagent'))
  assert.ok(delegation.config.some((row) => row.id === 'tool-subagent-codex' && row.disabled === true))
  const planning = /** @type {{ config: any[] }} */ (byId.get('planning'))
  assert.ok(String(planning.config[0].config.section).includes('exit_plan_mode'))
})

test('definition rows are fresh per call', () => {
  const first = buildVisionPresetDefinition({ platform: 'linux' })
  first.plugins[0].name = 'mutated'
  first.plugins[first.plugins.length - 1].id = 'mutated'
  const second = buildVisionPresetDefinition({ platform: 'linux' })
  assert.equal(second.plugins[0].name, '@deepseek-ai/dsh-persona')
  assert.equal(second.plugins[second.plugins.length - 1].id, 'vision-bench-tools')
})

test('registry contract detection separates 0.1.7 declarations from 0.1.6 directories', () => {
  assert.equal(isDeclarativeRegistry({ register: () => {} }), true)
  assert.equal(isDeclarativeRegistry({ register: () => {}, copy: () => {} }), false)
  assert.equal(isDeclarativeRegistry({ copy: () => {} }), false)
  assert.equal(isDeclarativeRegistry(null), false)
  assert.equal(isDeclarativeRegistry(undefined), false)
})

test('duplicate preset errors are recognised', () => {
  assert.equal(isDuplicatePresetError(new Error('Duplicate agent preset: vision-bench')), true)
  assert.equal(isDuplicatePresetError(new Error('EACCES')), false)
  assert.equal(isDuplicatePresetError('Duplicate agent preset: x'), true)
})
