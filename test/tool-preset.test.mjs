import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { apply } from '../host.js'
import { ensurePresetOverlay, PRESET_BACKUP_FAILED, PRESET_PERSONA, PRESET_RESTORE_FAILED, PRESET_WRITE_FAILED, REBUILD_INSTRUCTIONS, seedVisionBenchPreset } from '../bench-preset.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'

// bench-preset.mjs routes every fs call through createRequire('node:fs'), so
// patching the shared module object here injects failures into the migration.
const nodeFs = () => createRequire(import.meta.url)('node:fs')
function withFsPatched(patches, fn) {
  const fs = nodeFs()
  const saved = {}
  for (const [k, v] of Object.entries(patches)) { saved[k] = fs[k]; fs[k] = v }
  try { return fn(fs) } finally { for (const [k, v] of Object.entries(saved)) fs[k] = v }
}
const leftoverTemps = async (dir) => (await readdir(dir)).filter((n) => /\.tmp/.test(n))
const LEGACY_PERSONA_A = 'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物和 Modbus 连接以 vision_bench 工具为准：先 action=status，再 ls/select/build/read。不要猜测用户选了哪个工程。'
const LEGACY_PERSONA_B = 'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程、编译产物、进行中任务和时间线以 vision_bench 工具为准：先 action=status，再 map 看当前 Target 的文件树，然后 ls/select/build/read。不要猜测用户选了哪个工程或有哪些源文件。'
const personaComposition = (text) => ['- id: persona', '  name: x', '  config:', '    text: >-', '      ' + text, ''].join('\n')

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
  let bak2 = null
  try {
    const legacy = LEGACY_PERSONA_A
    await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(legacy))
    await writeFile(join(dir, 'preset.yml'), 'name: old\n')
    await writeFile(join(dir, '.dsh-vision-bench'), JSON.stringify({ owner: 'dsh-vision-bench' }))
    const out = ensurePresetOverlay(dir)
    assert.ok(out.backupDir)
    bak = out.backupDir
    assert.ok((await readdir(bak)).includes('agent.cordis.yml'))
    assert.ok((await readdir(bak)).includes('preset.yml'))
    assert.ok((await readdir(bak)).includes('.dsh-vision-bench'))
    assert.equal((await readFile(join(dir, 'agent.cordis.yml'), 'utf8')).match(/vision-bench-tools/g).length, 1)
    const opreset = await readFile(join(dir, 'preset.yml'), 'utf8')
    // drift it back to a KNOWN legacy persona so a second run needs a write (persona restore / row)
    const legacy2 = LEGACY_PERSONA_B
    await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(legacy2))
    const orig = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    const { createRequire } = await import('node:module')
    const fs = createRequire(import.meta.url)('node:fs')
    const ow = fs.writeFileSync
    let once = true
    // atomic write now writes a `.tmp<rand>` sibling then renames; match by basename prefix
    fs.writeFileSync = (p, ...r) => {
      if (String(p).includes(dir) && /agent\.cordis\.yml/.test(String(p)) && once) { once = false; throw new Error('x') }
      return ow(p, ...r)
    }
    let out2
    try { out2 = ensurePresetOverlay(dir) } finally { fs.writeFileSync = ow }
    assert.equal(out2.ok, false, 'write failure must fail the overlay step')
    assert.equal(out2.errorCode, 'PRESET_WRITE_FAILED', 'write failure must carry PRESET_WRITE_FAILED')
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), orig, 'agent.cordis.yml restored from backup')
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), opreset, 'preset.yml restored from backup')
    bak2 = out2.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
    if (bak2) await rm(bak2, { recursive: true, force: true }).catch(() => {})
  }
})

test('preset backup failure aborts before any write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-bakfail-'))
  let bak = null
  try {
    const legacy = 'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程以 vision_bench 工具为准。'
    const before = ['- id: persona', '  name: x', '  config:', '    text: >-', '      ' + legacy, ''].join('\n')
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), 'name: old\n')
    const { createRequire } = await import('node:module')
    const fs = createRequire(import.meta.url)('node:fs')
    const oc = fs.copyFileSync
    fs.copyFileSync = (s) => { if (String(s).endsWith('agent.cordis.yml')) throw new Error('copy-fail') ; return oc(s) }
    let out
    try { out = ensurePresetOverlay(dir) } finally { fs.copyFileSync = oc }
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, 'PRESET_BACKUP_FAILED', 'backup failure must be PRESET_BACKUP_FAILED')
    // nothing written
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'no write when backup failed')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('preset write-failure rollback deletes newly-created marker copy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-marker-'))
  let bak = null
  try {
    const legacy = 'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程以 vision_bench 工具为准。'
    await writeFile(join(dir, 'agent.cordis.yml'), ['- id: persona', '  name: x', '  config:', '    text: >-', '      ' + legacy, ''].join('\n'))
    await writeFile(join(dir, 'preset.yml'), 'name: old\n')
    // NO marker pre-existing: it will be created during write, then must be removed on rollback
    const { createRequire } = await import('node:module')
    const fs = createRequire(import.meta.url)('node:fs')
    const ow = fs.writeFileSync
    fs.writeFileSync = (p, ...r) => {
      if (String(p).includes(dir) && /agent\.cordis\.yml/.test(String(p))) throw new Error('boom')
      return ow(p, ...r)
    }
    let out
    try { out = ensurePresetOverlay(dir) } finally { fs.writeFileSync = ow }
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, 'PRESET_WRITE_FAILED')
    // marker was created by intent but rollback should remove it (didn't exist before)
    const markerPath = join(dir, '.dsh-vision-bench')
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(markerPath), false, 'newly-created marker must be removed on rollback')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('composition write failure restores every file and leaves no temp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-cwfail-'))
  let bak = null
  try {
    const before = personaComposition(LEGACY_PERSONA_A)
    const beforePreset = 'name: user-preset\n'
    const beforeMarker = JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), beforePreset)
    await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
    const fs = nodeFs()
    const ow = fs.writeFileSync
    const out = withFsPatched({
      writeFileSync(p, ...r) {
        if (String(p).includes(dir) && /agent\.cordis\.yml\.tmp/.test(String(p))) throw new Error('composition-write-fail')
        return ow(p, ...r)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, PRESET_WRITE_FAILED)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'composition restored from backup')
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset, 'preset.yml untouched')
    assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker, 'marker untouched')
    assert.deepEqual(await leftoverTemps(dir), [], 'no leftover temp files after failed atomic write')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('preset.yml write failure restores every file and leaves no temp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-pwfail-'))
  let bak = null
  try {
    const before = personaComposition(LEGACY_PERSONA_A)
    const beforePreset = 'name: user-preset\n'
    const beforeMarker = JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), beforePreset)
    await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
    const fs = nodeFs()
    const ow = fs.writeFileSync
    const out = withFsPatched({
      writeFileSync(p, ...r) {
        if (String(p).includes(dir) && /preset\.yml\.tmp/.test(String(p))) throw new Error('preset-write-fail')
        return ow(p, ...r)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, PRESET_WRITE_FAILED)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'composition restored from backup')
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset, 'preset.yml restored from backup')
    assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker, 'marker restored from backup')
    assert.deepEqual(await leftoverTemps(dir), [], 'no leftover temp files after failed atomic write')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('marker write failure rolls back all files and never writes the marker directly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-mkrfail-'))
  let bak = null
  try {
    const before = personaComposition(LEGACY_PERSONA_A)
    const beforePreset = 'name: user-preset\n'
    const beforeMarker = JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), beforePreset)
    await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
    const fs = nodeFs()
    const ow = fs.writeFileSync
    let directMarkerWrites = 0
    const out = withFsPatched({
      writeFileSync(p, ...r) {
        const s = String(p)
        if (s.includes(dir) && /\.dsh-vision-bench$/.test(s)) directMarkerWrites++
        if (s.includes(dir) && /\.dsh-vision-bench\.tmp/.test(s)) throw new Error('marker-write-fail')
        return ow(p, ...r)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, PRESET_WRITE_FAILED)
    assert.equal(directMarkerWrites, 0, 'marker must only be written atomically via tmp+rename, never writeFileSync(target)')
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'composition restored from backup')
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset, 'preset.yml restored from backup')
    assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker, 'marker restored from backup')
    assert.deepEqual(await leftoverTemps(dir), [], 'no leftover temp files after failed atomic write')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('rename failure cleans its temp file and restores all files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-rnfail-'))
  let bak = null
  try {
    const before = personaComposition(LEGACY_PERSONA_A)
    const beforePreset = 'name: user-preset\n'
    const beforeMarker = JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), beforePreset)
    await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
    const fs = nodeFs()
    const or = fs.renameSync
    const out = withFsPatched({
      renameSync(s, d) {
        if (String(s).includes(dir) && String(s).includes('.tmp')) throw new Error('rename-fail')
        return or(s, d)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, PRESET_WRITE_FAILED)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'composition restored from backup')
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset, 'preset.yml restored from backup')
    assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker, 'marker restored from backup')
    assert.deepEqual(await leftoverTemps(dir), [], 'failed atomic write must remove its temp file')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('rollback copy failure surfaces PRESET_RESTORE_FAILED', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-rcfail-'))
  let bak = null
  try {
    const before = personaComposition(LEGACY_PERSONA_A)
    const beforePreset = 'name: user-preset\n'
    const beforeMarker = JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), beforePreset)
    await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
    const fs = nodeFs()
    const ow = fs.writeFileSync
    const oc = fs.copyFileSync
    const out = withFsPatched({
      writeFileSync(p, ...r) {
        // force the write phase to fail so rollback runs
        if (String(p).includes(dir) && /\.dsh-vision-bench\.tmp/.test(String(p))) throw new Error('marker-write-fail')
        return ow(p, ...r)
      },
      copyFileSync(s, d) {
        // restore direction: source lives in the backup dir, destination in the preset dir
        if (String(s).includes('.vision-bench.backup.') && String(d).includes(dir)) throw new Error('restore-copy-fail')
        return oc(s, d)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, PRESET_RESTORE_FAILED)
    assert.match(out.error, /回滚失败/)
    assert.ok(out.backupDir, 'restore-failed result must still expose the backup dir')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('rollback deletes newly-created preset.yml and marker after a later write failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-newdel-'))
  let bak = null
  try {
    // only the composition pre-exists; preset.yml and marker are created by migration
    const before = personaComposition(LEGACY_PERSONA_A)
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    const fs = nodeFs()
    const ow = fs.writeFileSync
    const out = withFsPatched({
      writeFileSync(p, ...r) {
        if (String(p).includes(dir) && /\.dsh-vision-bench\.tmp/.test(String(p))) throw new Error('marker-write-fail')
        return ow(p, ...r)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, false)
    assert.equal(out.errorCode, PRESET_WRITE_FAILED)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'composition restored from backup')
    assert.equal(existsSync(join(dir, 'preset.yml')), false, 'newly-created preset.yml must be removed on rollback')
    assert.equal(existsSync(join(dir, '.dsh-vision-bench')), false, 'newly-created marker must be removed on rollback')
    assert.deepEqual(await leftoverTemps(dir), [], 'no leftover temp files')
    bak = out.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('user-modified persona is never lost (needsReview keeps it; rollback restores it)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-user-'))
  let bak = null
  try {
    const userPersona = 'You are my personal Keil debugger for the 流水线 controller. Keep answers short.'
    const before = personaComposition(userPersona)
    const beforePreset = 'name: user-preset\n'
    const beforeMarker = JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 })
    await writeFile(join(dir, 'agent.cordis.yml'), before)
    await writeFile(join(dir, 'preset.yml'), beforePreset)
    await writeFile(join(dir, '.dsh-vision-bench'), beforeMarker)
    // failed migration must roll back to the exact user content
    const fs = nodeFs()
    const ow = fs.writeFileSync
    const failed = withFsPatched({
      writeFileSync(p, ...r) {
        if (String(p).includes(dir) && /\.dsh-vision-bench\.tmp/.test(String(p))) throw new Error('marker-write-fail')
        return ow(p, ...r)
      },
    }, () => ensurePresetOverlay(dir))
    assert.equal(failed.ok, false)
    assert.equal(failed.errorCode, PRESET_WRITE_FAILED)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before, 'user composition byte-identical after rollback')
    assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset, 'user preset.yml byte-identical after rollback')
    assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker, 'marker byte-identical after rollback')
    // successful run must keep the unknown persona and only report needsReview
    const ok = ensurePresetOverlay(dir)
    assert.equal(ok.ok, false)
    assert.equal(ok.needsReview, true)
    assert.equal(ok.personaNeedsReview, true)
    const after = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    assert.ok(after.includes('vision-bench-tools'))
    const yaml = await import('yaml')
    const doc = yaml.parseDocument(after)
    let personaText = null
    for (const item of doc.contents.items) {
      if (item.get('id') === 'persona') personaText = item.getIn(['config', 'text'])
    }
    assert.equal(personaText, userPersona, 'user persona must survive the overlay unchanged')
    bak = ok.backupDir || null
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('fully consistent preset is left untouched (no backup, no writes)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-idem-'))
  let bak = null
  try {
    await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(LEGACY_PERSONA_A))
    const first = ensurePresetOverlay(dir)
    assert.equal(first.ok, true)
    bak = first.backupDir || null
    const snapshot = {}
    for (const n of ['agent.cordis.yml', 'preset.yml', '.dsh-vision-bench']) {
      snapshot[n] = await readFile(join(dir, n), 'utf8')
    }
    const calls = []
    const out = withFsPatched({
      writeFileSync() { calls.push('write'); throw new Error('must-not-write') },
      renameSync() { calls.push('rename'); throw new Error('must-not-rename') },
      copyFileSync() { calls.push('copy'); throw new Error('must-not-copy') },
      mkdirSync() { calls.push('mkdir'); throw new Error('must-not-mkdir') },
    }, () => ensurePresetOverlay(dir))
    assert.equal(out.ok, true)
    assert.equal(out.unchanged, true)
    assert.deepEqual(calls, [], 'fully consistent preset must not trigger any write/backup')
    for (const n of Object.keys(snapshot)) {
      assert.equal(await readFile(join(dir, n), 'utf8'), snapshot[n], n + ' byte-identical on repeat run')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (bak) await rm(bak, { recursive: true, force: true }).catch(() => {})
  }
})

test('invalid or foreign ownership marker fails closed and is never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-failclosed-'))
  try {
    const standard = personaComposition(PRESET_PERSONA)
    const cases = [
      { name: 'garbage', marker: 'not-json {{{' },
      { name: 'unparseable-json', marker: '{"owner": ' },
      { name: 'foreign-owner', marker: JSON.stringify({ owner: 'someone-else' }) },
    ]
    for (const c of cases) {
      const sub = join(dir, c.name)
      await mkdir(sub, { recursive: true })
      await writeFile(join(dir, c.name, 'agent.cordis.yml'), standard)
      await writeFile(join(dir, c.name, '.dsh-vision-bench'), c.marker)
      const fs = nodeFs()
      const ow = fs.writeFileSync
      let writes = 0
      const out = withFsPatched({
        writeFileSync(p, ...r) {
          if (String(p).includes(sub)) { writes++; throw new Error('must not write') }
          return ow(p, ...r)
        },
      }, () => ensurePresetOverlay(sub))
      assert.equal(out.ok, false, c.name + ' must fail closed')
      assert.match(out.error, /其他预设占用/)
      assert.equal(writes, 0, c.name + ' must not attempt any write')
      assert.equal(await readFile(join(sub, '.dsh-vision-bench'), 'utf8'), c.marker, c.name + ' marker untouched')
      assert.equal(await readFile(join(sub, 'agent.cordis.yml'), 'utf8'), standard, c.name + ' composition untouched')
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('seedVisionBenchPreset fails closed on invalid ownership marker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-seedfail-'))
  const dir = join(home, '.agent-presets', 'vision-bench')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(PRESET_PERSONA))
    const marker = 'not-json {{{'
    await writeFile(join(dir, '.dsh-vision-bench'), marker)
    const out = await seedVisionBenchPreset(null, home)
    assert.equal(out.ok, false)
    assert.match(out.error, /其他预设占用/)
    assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), marker, 'invalid marker untouched')
  } finally { await rm(home, { recursive: true, force: true }) }
})
