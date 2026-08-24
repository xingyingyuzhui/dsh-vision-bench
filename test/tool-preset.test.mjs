import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { apply } from '../host.js'
import { ensurePresetOverlay, PRESET_PERSONA, REBUILD_INSTRUCTIONS, seedVisionBenchPreset } from '../bench-preset.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'

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
  assert.ok(tools[0].parameters.properties.action.enum.includes('map'))
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
    // persona should remain standard (not Vision) – check via yaml parse to handle folded style
    const yaml = await import('yaml')
    const doc = yaml.parseDocument(text)
    let personaText = null
    for (const item of doc.contents.items) {
      if (item.get('id') === 'persona') personaText = item.getIn(['config', 'text'])
    }
    assert.equal(personaText, PRESET_PERSONA)
    // Vision guidance is now via host prompt section, not hard-coded persona
    assert.equal(text.includes('Vision 台架'), false)
    // ownership file should be JSON with Vision模式 metadata
    const presetText = await (await import('node:fs/promises')).readFile(join(dir, 'preset.yml'), 'utf8')
    assert.match(presetText, /Vision模式/)
    const marker = await (await import('node:fs/promises')).readFile(join(dir, '.dsh-vision-bench'), 'utf8')
    const ownership = JSON.parse(marker)
    assert.equal(ownership.owner, 'dsh-vision-bench')
    assert.equal(ownership.presetSchemaVersion, 2)
    assert.equal(ownership.pluginRowId, 'vision-bench-tools')
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
    await writeFile(project, '<Project/>')
    const selected = await runVisionBench(home, { action: 'select', path: project }, cwd)
    assert.equal(selected.ok, true)
    assert.equal(selected.keil.project, project)
    const status = await runVisionBench(home, { action: 'status' }, cwd)
    assert.equal(status.ok, true)
    assert.equal(status.keil.project, project)
    assert.ok(status.log.some((item) => item.action === 'select-project'))
    assert.ok(Array.isArray(status.tasks))
    assert.ok(Array.isArray(status.running))
    assert.ok(Array.isArray(status.modbus.points))
    assert.ok(status.modbus.conn && typeof status.modbus.conn === 'object')
    assert.ok(status.timeline.some((item) => item.kind === 'select-project'))
    const escaped = await runVisionBench(home, { action: 'select', path: join(home, 'other.uvprojx') }, cwd)
    assert.equal(escaped.ok, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('agent single-point read patches the active device address', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-read-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        conn: { sim: true },
        points: [{ name: 'p', function: 3, address: 0 }],
      },
    })
    const ran = await runVisionBench(home, { action: 'read', function: 3, address: 10, count: 1 }, cwd, { source: 'agent' })
    assert.equal(ran.ok, true)
    assert.match(ran.summary || ran.result?.summary || ran.summary || '', /读取成功/)
    const ws = loadWorkspace(home, cwd)
    // point model keeps the read as a transient operation; points table unchanged
    assert.ok(Array.isArray(ws.modbus.points))
    assert.equal(ws.modbus.points.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('seedVisionBenchPreset does not overlay a foreign preset', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-preset-foreign-'))
  const dir = join(home, '.agent-presets', 'vision-bench')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'agent.cordis.yml'), 'name: other\n')
    const out = await seedVisionBenchPreset(null, home)
    assert.equal(out.ok, false)
    const text = await (await import('node:fs/promises')).readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    assert.equal(text, 'name: other\n')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('preset yaml error does not overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-yaml-'))
  try {
    const bad = '- id: persona\n  config: [unclosed\n'
    await writeFile(join(dir, 'agent.cordis.yml'), bad)
    const out = ensurePresetOverlay(dir)
    assert.equal(out.ok, false)
    assert.ok(out.rebuildHelp)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), bad)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('preset backup and write-failure recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-bak-'))
  let bak = null
  try {
    const legacy = 'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 ls/select/build/read。不要猜测用户选了哪个工程。'
    await writeFile(join(dir, 'agent.cordis.yml'), ['- id: persona', '  name: x', '  config:', '    text: >-', '      ' + legacy, ''].join('\n'))
    await writeFile(join(dir, 'preset.yml'), 'name: old\n')
    await writeFile(join(dir, '.dsh-vision-bench'), JSON.stringify({ owner: 'dsh-vision-bench' }))
    const out = ensurePresetOverlay(dir)
    assert.ok(out.backupDir)
    bak = out.backupDir
    assert.ok((await readdir(bak)).includes('agent.cordis.yml'))
    assert.equal((await readFile(join(dir, 'agent.cordis.yml'), 'utf8')).match(/vision-bench-tools/g).length, 1)
    const orig = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    const { createRequire } = await import('node:module')
    const fs = createRequire(import.meta.url)('node:fs')
    const ow = fs.writeFileSync
    let once = true
    fs.writeFileSync = (p, ...r) => { if (String(p).includes(dir) && String(p).endsWith('agent.cordis.yml') && once) { once = false; throw new Error('x') } return ow(p, ...r) }
    let out2
    try { out2 = ensurePresetOverlay(dir) } finally { fs.writeFileSync = ow }
    if (!out2.ok) assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), orig)
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})
