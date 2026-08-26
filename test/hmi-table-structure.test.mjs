import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hmi = readFileSync(join(root, 'bench-hmi.mjs'), 'utf8')

test('连接表表头为四列：名称|角色|端点/状态|操作', () => {
  assert.match(hmi, /el\('th',\s*null,\s*'名称'\)/)
  assert.match(hmi, /el\('th',\s*null,\s*t\('role'\)\s*\|\|\s*'角色'\)/)
  assert.match(hmi, /el\('th',\s*null,\s*'端点\/状态'\)/)
  assert.match(hmi, /el\('th',\s*null,\s*'操作'\)/)
})

test('设备工具栏顺序：添加点位→批量添加→读取→编辑点位→导入→导出→AI；编辑设备在卡片右上角', () => {
  const m = hmi.match(/添加点位[\s\S]*?batchAdd[\s\S]*?readAll[\s\S]*?ptEdit[\s\S]*?csvImport[\s\S]*?csvExport[\s\S]*?},\s*'AI'\)/)
  assert.ok(m, 'toolbar order must match plan')
  // 编辑设备在设备头右上角，不在工具栏
  assert.match(hmi, /dvb-dev-head[\s\S]*?devEdit[\s\S]*?编辑设备/)
  assert.doesNotMatch(hmi, /readAll[\s\S]{0,400}?devEdit[\s\S]{0,200}?ptEdit/)
  assert.doesNotMatch(hmi, /devPts\.length \+ ' 个点位'/)
  // 设备编辑一行：保存|取消|删除设备
  assert.match(hmi, /dvb-dev-edit-row/)
  assert.match(hmi, /devSave[\s\S]*?csvCancel[\s\S]*?devDelete/)
  // 点位编辑独立保存
  assert.match(hmi, /savePointsEdit/)
  assert.match(hmi, /enterPointsEdit/)
})

test('连接总览卡片只在全部连接 tab 渲染', () => {
  assert.match(hmi, /hmiTab === 'all'[\s\S]*?connListPanel/)
  // 单连接 return：在 deviceCardsPanel 前不应再挂载 connListPanel
  const idx = hmi.lastIndexOf("return el('div', { className: 'dvb-page' }")
  assert.ok(idx > 0, 'single-conn page return exists')
  const single = hmi.slice(idx)
  assert.match(single, /deviceCardsPanel/)
  assert.doesNotMatch(single, /connListPanel/)
})

test('pointTheadOf 按设备生成，不依赖全局唯一表头', () => {
  assert.match(hmi, /const pointTheadOf = \(d\)/)
  assert.match(hmi, /pointTheadOf\(d\)/)
  assert.doesNotMatch(hmi, /el\('table'[\s\S]{0,80}pointThead,/)
})

test('连接编辑器不再提供站号/单元字段', () => {
  assert.doesNotMatch(hmi, /站号\/单元/)
  assert.doesNotMatch(hmi, /connForm\.conn\.slave/)
})
