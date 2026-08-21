import assert from 'node:assert/strict'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../host.js'
import { ensurePresetOverlay, PRESET_PERSONA } from '../bench-preset.mjs'
import { runVisionBench } from '../bench-tool.mjs'

test('agent role registers vision_bench and skips HTTP routes', () => {
  const tools = []
  apply({
    tools: {
      register(def) {
        tools.push(def)
        return () => {}
      },
    },
    agentPresets: {},
    webServer: {
      register() { throw new Error('host routes must not mount on agent plane') },
    },
    effect() {},
  }, { role: 'agent' })
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'vision_bench')
  assert.equal(tools[0].parameters.type, 'object')
  assert.ok(tools[0].parameters.required.includes('action'))
})

test('ensurePresetOverlay appends the agent-plane row and persona', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-preset-'))
  try {
    await writeFile(join(dir, 'agent.cordis.yml'), [
      '- id: persona',
      '  name: \'@deepseek-ai/dsh-persona\'',
      '  config:',
      '    text: >-',
      '      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.',
      '',
    ].join('\n'))
    const out = ensurePresetOverlay(dir)
    assert.equal(out.ok, true)
    const text = await (await import('node:fs/promises')).readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    assert.match(text, /id: vision-bench-tools/)
    assert.match(text, /role: agent/)
    assert.match(text, /vision_bench/)
    assert.equal(text.indexOf(PRESET_PERSONA) >= 0, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runVisionBench status and select stay inside the workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-tool-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const miss = await runVisionBench(home, { action: 'status' }, '')
    assert.equal(miss.ok, false)
    const project = join(cwd, 'app.uvprojx')
    const selected = await runVisionBench(home, { action: 'select', path: project }, cwd)
    assert.equal(selected.ok, true)
    assert.equal(selected.keil.project, project)
    const status = await runVisionBench(home, { action: 'status' }, cwd)
    assert.equal(status.ok, true)
    assert.equal(status.keil.project, project)
    assert.ok(status.log.some((item) => item.action === 'select-project'))
    assert.ok(Array.isArray(status.tasks))
    assert.ok(Array.isArray(status.running))
    assert.ok(Array.isArray(status.modbus.segments))
    assert.ok(Array.isArray(status.modbus.devices))
    assert.ok(status.timeline.some((item) => item.kind === 'select-project'))
    const escaped = await runVisionBench(home, { action: 'select', path: join(home, 'other.uvprojx') }, cwd)
    assert.equal(escaped.ok, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
