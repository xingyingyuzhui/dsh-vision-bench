// @ts-check
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findFirmwareArtifacts } from '../../src/application/debug/debug-launch-spec-service.mjs'

const root = join(tmpdir(), `dvb-artifacts-${Date.now()}`)

test.before(() => {
  // 典型 Keil MDK5 布局：工程文件与产物都在 MDK-ARM/ 子目录下
  mkdirSync(join(root, 'keil-nested', 'MDK-ARM', 'Objects'), { recursive: true })
  writeFileSync(join(root, 'keil-nested', 'MDK-ARM', 'App.uvprojx'), '<Project/>')
  writeFileSync(join(root, 'keil-nested', 'MDK-ARM', 'Objects', 'App.axf'), 'ELF')

  // CMake 布局：产物在 build/
  mkdirSync(join(root, 'cmake-flat', 'build'), { recursive: true })
  writeFileSync(join(root, 'cmake-flat', 'build', 'firmware.elf'), 'ELF')

  // 空目录
  mkdirSync(join(root, 'empty'), { recursive: true })
})

test.after(() => {
  rmSync(root, { recursive: true, force: true })
})

test('C3: 嵌套 Keil 工程 —— 仅搜 cwd 找不到产物', () => {
  const ws = join(root, 'keil-nested')
  assert.deepEqual(findFirmwareArtifacts(ws), [], '旧行为：产物在 MDK-ARM/Objects，搜不到')
})

test('C3: 嵌套 Keil 工程 —— 以工程目录为搜索根能找到产物', () => {
  const ws = join(root, 'keil-nested')
  const found = findFirmwareArtifacts(ws, { projectPath: join(ws, 'MDK-ARM', 'App.uvprojx') })
  assert.equal(found.length, 1)
  assert.ok(found[0].endsWith(join('MDK-ARM', 'Objects', 'App.axf')))
})

test('C3: 顶层 build/ 布局仍然可用（向后兼容）', () => {
  const ws = join(root, 'cmake-flat')
  const found = findFirmwareArtifacts(ws)
  assert.equal(found.length, 1)
  assert.ok(found[0].endsWith('firmware.elf'))
})

test('C3: 空目录返回空数组', () => {
  assert.deepEqual(findFirmwareArtifacts(join(root, 'empty')), [])
})

test('C3: 不存在的 cwd 返回空数组而不抛错', () => {
  assert.deepEqual(findFirmwareArtifacts(join(root, 'nope')), [])
  assert.deepEqual(findFirmwareArtifacts(''), [])
})

test('C3: 同时存在工程根与工作区根候选时去重', () => {
  const ws = join(root, 'cmake-flat')
  const found = findFirmwareArtifacts(ws, { projectPath: join(ws, 'build', 'firmware.elf') })
  assert.equal(new Set(found).size, found.length, '不应有重复路径')
})
