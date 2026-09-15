import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { PRESET_RESTORE_FAILED, PRESET_WRITE_FAILED, ensurePresetOverlay } from '../../bench-preset.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'
import {
  LEGACY_PERSONA_A,
  LEGACY_PERSONA_B,
  leftoverTemps,
  personaComposition,
  seedOwnedLegacy,
  trackBackup,
  withFsPatched,
} from '../helpers/preset-fixtures.mjs'

test('preset backup and write-failure recovery', async (t) => {
  const dir = await createTempDir(t, 'dvb-bak-')
  await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(LEGACY_PERSONA_A))
  await writeFile(join(dir, 'preset.yml'), 'name: old\n')
  await writeFile(join(dir, '.dsh-vision-bench'), JSON.stringify({ owner: 'dsh-vision-bench' }))
  const out = ensurePresetOverlay(dir)
  assert.ok(out.backupDir)
  trackBackup(t, out)
  assert.ok((await readdir(out.backupDir)).includes('agent.cordis.yml'))
  assert.ok((await readdir(out.backupDir)).includes('preset.yml'))
  assert.ok((await readdir(out.backupDir)).includes('.dsh-vision-bench'))
  assert.equal((await readFile(join(dir, 'agent.cordis.yml'), 'utf8')).match(/vision-bench-tools/g).length, 1)
  const opreset = await readFile(join(dir, 'preset.yml'), 'utf8')
  await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(LEGACY_PERSONA_B))
  const orig = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  let once = true
  const out2 = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /agent\.cordis\.yml/.test(String(p)) && once) {
          once = false
          throw new Error('x')
        }
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out2.ok, false)
  assert.equal(out2.errorCode, 'PRESET_WRITE_FAILED')
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), orig)
  assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), opreset)
  trackBackup(t, out2)
})

test('preset backup failure aborts before any write', async (t) => {
  const dir = await createTempDir(t, 'dvb-bakfail-')
  const legacy =
    'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程以 vision_bench 工具为准。'
  const before = personaComposition(legacy)
  await writeFile(join(dir, 'agent.cordis.yml'), before)
  await writeFile(join(dir, 'preset.yml'), 'name: old\n')
  const out = await withFsPatched(
    {
      copyFileSync(origCopy, s, ...r) {
        if (String(s).endsWith('agent.cordis.yml')) throw new Error('copy-fail')
        return origCopy(s, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, 'PRESET_BACKUP_FAILED')
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  trackBackup(t, out)
})

test('preset write-failure rollback deletes newly-created marker copy', async (t) => {
  const dir = await createTempDir(t, 'dvb-marker-')
  const legacy =
    'You are a Vision 台架 agent powered by the {{model}} model. Your working directory is {{cwd}}. 现场工程以 vision_bench 工具为准。'
  await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(legacy))
  await writeFile(join(dir, 'preset.yml'), 'name: old\n')
  const out = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /agent\.cordis\.yml/.test(String(p))) throw new Error('boom')
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, 'PRESET_WRITE_FAILED')
  assert.equal(existsSync(join(dir, '.dsh-vision-bench')), false)
  trackBackup(t, out)
})

test('composition write failure restores every file and leaves no temp files', async (t) => {
  const dir = await createTempDir(t, 'dvb-cwfail-')
  const { before, beforePreset, beforeMarker } = await seedOwnedLegacy(dir)
  const out = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /agent\.cordis\.yml\.tmp/.test(String(p)))
          throw new Error('composition-write-fail')
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, PRESET_WRITE_FAILED)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset)
  assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker)
  assert.deepEqual(await leftoverTemps(dir), [])
  trackBackup(t, out)
})

test('preset.yml write failure restores every file and leaves no temp files', async (t) => {
  const dir = await createTempDir(t, 'dvb-pwfail-')
  const { before, beforePreset, beforeMarker } = await seedOwnedLegacy(dir)
  const out = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /preset\.yml\.tmp/.test(String(p))) throw new Error('preset-write-fail')
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, PRESET_WRITE_FAILED)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset)
  assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker)
  assert.deepEqual(await leftoverTemps(dir), [])
  trackBackup(t, out)
})

test('marker write failure rolls back all files and never writes the marker directly', async (t) => {
  const dir = await createTempDir(t, 'dvb-mkrfail-')
  const { before, beforePreset, beforeMarker } = await seedOwnedLegacy(dir)
  let directMarkerWrites = 0
  const out = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        const s = String(p)
        if (s.includes(dir) && /\.dsh-vision-bench$/.test(s)) directMarkerWrites++
        if (s.includes(dir) && /\.dsh-vision-bench\.tmp/.test(s)) throw new Error('marker-write-fail')
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, PRESET_WRITE_FAILED)
  assert.equal(directMarkerWrites, 0)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset)
  assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker)
  assert.deepEqual(await leftoverTemps(dir), [])
  trackBackup(t, out)
})

test('rename failure cleans its temp file and restores all files', async (t) => {
  const dir = await createTempDir(t, 'dvb-rnfail-')
  const { before, beforePreset, beforeMarker } = await seedOwnedLegacy(dir)
  const out = await withFsPatched(
    {
      renameSync(origRename, s, d) {
        if (String(s).includes(dir) && String(s).includes('.tmp')) throw new Error('rename-fail')
        return origRename(s, d)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, PRESET_WRITE_FAILED)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset)
  assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker)
  assert.deepEqual(await leftoverTemps(dir), [])
  trackBackup(t, out)
})

test('rollback copy failure surfaces PRESET_RESTORE_FAILED', async (t) => {
  const dir = await createTempDir(t, 'dvb-rcfail-')
  await seedOwnedLegacy(dir)
  const out = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /\.dsh-vision-bench\.tmp/.test(String(p))) throw new Error('marker-write-fail')
        return origWrite(p, ...r)
      },
      copyFileSync(origCopy, s, d) {
        if (String(s).includes('.vision-bench.backup.') && String(d).includes(dir))
          throw new Error('restore-copy-fail')
        return origCopy(s, d)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, PRESET_RESTORE_FAILED)
  assert.match(out.error, /回滚失败/)
  assert.ok(out.backupDir)
  trackBackup(t, out)
})

test('rollback deletes newly-created preset.yml and marker after a later write failure', async (t) => {
  const dir = await createTempDir(t, 'dvb-newdel-')
  const before = personaComposition(LEGACY_PERSONA_A)
  await writeFile(join(dir, 'agent.cordis.yml'), before)
  const out = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /\.dsh-vision-bench\.tmp/.test(String(p))) throw new Error('marker-write-fail')
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, false)
  assert.equal(out.errorCode, PRESET_WRITE_FAILED)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  assert.equal(existsSync(join(dir, 'preset.yml')), false)
  assert.equal(existsSync(join(dir, '.dsh-vision-bench')), false)
  assert.deepEqual(await leftoverTemps(dir), [])
  trackBackup(t, out)
})

test('user-modified persona is never lost (needsReview keeps it; rollback restores it)', async (t) => {
  const dir = await createTempDir(t, 'dvb-user-')
  const userPersona = 'You are my personal Keil debugger for the 流水线 controller. Keep answers short.'
  const { before, beforePreset, beforeMarker } = await seedOwnedLegacy(dir, { persona: userPersona })
  const failed = await withFsPatched(
    {
      writeFileSync(origWrite, p, ...r) {
        if (String(p).includes(dir) && /\.dsh-vision-bench\.tmp/.test(String(p))) throw new Error('marker-write-fail')
        return origWrite(p, ...r)
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(failed.ok, false)
  assert.equal(failed.errorCode, PRESET_WRITE_FAILED)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), before)
  assert.equal(await readFile(join(dir, 'preset.yml'), 'utf8'), beforePreset)
  assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), beforeMarker)
  const ok = ensurePresetOverlay(dir)
  assert.equal(ok.ok, false)
  assert.equal(ok.needsReview, true)
  assert.equal(ok.personaNeedsReview, true)
  const after = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.ok(after.includes('vision-bench-tools'))
  const yaml = await import('yaml')
  const doc = yaml.parseDocument(after)
  let personaPrefix = null
  let personaText = null
  for (const item of doc.contents.items) {
    if (item.get('id') === 'persona') {
      personaPrefix = item.getIn(['config', 'prefix'])
      personaText = item.getIn(['config', 'text'])
    }
  }
  assert.equal(personaPrefix, userPersona)
  assert.equal(personaText, undefined)
  trackBackup(t, ok)
})
