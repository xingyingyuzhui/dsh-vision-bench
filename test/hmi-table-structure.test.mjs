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

test('设备工具栏顺序：添加点位→批量添加→读取→编辑→导入→导出→Agent 图标', () => {
  const m = hmi.match(/添加点位[\s\S]*?batchAdd[\s\S]*?readAll[\s\S]*?devEdit[\s\S]*?csvImport[\s\S]*?csvExport[\s\S]*?dvb-btn-icon/)
  assert.ok(m, 'toolbar order must match plan')
  // 编辑态工具栏：保存修改|取消|删除设备
  assert.match(hmi, /devSave[\s\S]*?csvCancel[\s\S]*?devDelete/)
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
