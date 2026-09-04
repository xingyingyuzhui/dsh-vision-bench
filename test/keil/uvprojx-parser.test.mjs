import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  listTargets,
  parseUvprojxFile,
  pickTarget,
  readGroups,
  readOutputOptions,
  readVariousControls,
  splitDefines,
  splitIncludePath,
} from '../../src/infrastructure/keil/uvprojx-parser.mjs'

const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../fixtures/keil')

test('splitIncludePath splits semicolons correctly', () => {
  assert.deepEqual(splitIncludePath('inc;../outside;  lib/inc  ;;'), ['inc', '../outside', 'lib/inc'])
  assert.deepEqual(splitIncludePath(''), [])
})

test('splitDefines splits commas and semicolons up to limit', () => {
  assert.deepEqual(splitDefines('USE_STD; STM32F10X, DEBUG'), ['USE_STD', 'STM32F10X', 'DEBUG'])
  assert.deepEqual(splitDefines(''), [])
})

test('listTargets reads all targets in order', async () => {
  const multiPath = join(FIXTURES_DIR, 'multi-target.uvprojx')
  const targets = await listTargets(multiPath)
  assert.deepEqual(targets, [{ name: 'STM32F103_Flash' }, { name: 'STM32F103_RAM' }])
})

test('uvprojx-parser throws on non-existent or invalid file extension', async () => {
  await assert.rejects(listTargets(join(FIXTURES_DIR, 'non-existent.uvprojx')), /工程文件不存在/)
  await assert.rejects(listTargets(join(FIXTURES_DIR, 'simple.uvoptx')), /仅支持 \.uvprojx 文件/)
})

test('parseUvprojxFile reads groups, controls, and output options', async () => {
  const simplePath = join(FIXTURES_DIR, 'simple.uvprojx')
  const { xmlRoot } = await parseUvprojxFile(simplePath)
  const picked = pickTarget(xmlRoot, 'Debug')
  assert.ok(picked)
  assert.equal(picked.targetName, 'Debug')

  const controls = readVariousControls(picked.targetNode)
  assert.deepEqual(controls.includes, ['inc', '../outside'])
  assert.deepEqual(controls.defines, ['DEBUG', 'USE_STDPERIPH'])

  const groups = readGroups(picked.targetNode)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'User')
  assert.equal(groups[0].files.length, 1)
  assert.equal(groups[0].files[0].name, 'main.c')
  assert.equal(groups[0].files[0].path, 'src/main.c')

  const outputs = readOutputOptions(picked.targetNode)
  assert.equal(outputs.outputDirectory, '.\\Objects\\')
  assert.equal(outputs.outputName, 'simple_firmware')
})
