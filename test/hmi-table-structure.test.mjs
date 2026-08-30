import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hmiDir = join(root, 'src/ui/hmi')
const hmi = readdirSync(hmiDir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => readFileSync(join(hmiDir, f), 'utf8'))
  .join('\n')

test('连接表表头为四列：名称|角色|端点/状态|操作', async () => {
  assert.match(hmi, /el\('th',\s*null,\s*'名称'\)/)
  assert.match(hmi, /el\('th',\s*null,\s*t\('role'\)\s*\|\|\s*'角色'\)/)
  assert.match(hmi, /el\('th',\s*null,\s*'端点\/状态'\)/)
  assert.match(hmi, /el\('th',\s*null,\s*'操作'\)/)
})

test('设备工具栏顺序：添加点位→批量添加→读取→编辑点位→导入→导出→AI；编辑设备在卡片右上角', async () => {
  const m = hmi.match(
    /addPoint[\s\S]*?batchAdd[\s\S]*?readAll[\s\S]*?ptEdit[\s\S]*?csvImport[\s\S]*?csvExport[\s\S]*?'AI'/,
  )
  assert.ok(m, 'toolbar order must match plan')
  // 编辑设备在设备头右上角，不在工具栏
  assert.match(hmi, /dvb-dev-head[\s\S]*?devEdit[\s\S]*?编辑设备/)
  assert.doesNotMatch(hmi, /readAll[\s\S]{0,800}?devEdit[\s\S]{0,200}?ptEdit/)
  assert.doesNotMatch(hmi, /devPts\.length \+ ' 个点位'/)
  // 设备编辑一行：保存|取消|删除设备
  assert.match(hmi, /dvb-dev-edit-row/)
  assert.match(hmi, /devSave[\s\S]*?csvCancel[\s\S]*?devDelete/)
  // 点位编辑独立保存
  assert.match(hmi, /savePointsEdit/)
  assert.match(hmi, /enterPointsEdit/)
})

test('连接总览卡片只在全部连接 tab 渲染', async () => {
  assert.match(hmi, /hmiTab === 'all'[\s\S]*?renderConnectionOverview/)
  const overview = readFileSync(join(hmiDir, 'connection-overview.mjs'), 'utf8')
  const workspace = readFileSync(join(hmiDir, 'connection-workspace.mjs'), 'utf8')
  assert.match(overview, /connListPanel/)
  assert.match(workspace, /deviceCardsPanel/)
  assert.doesNotMatch(workspace, /connListPanel/)
})

test('pointTheadOf 按设备生成，不依赖全局唯一表头', async () => {
  assert.match(hmi, /export function renderPointThead|function renderPointThead/)
  assert.match(hmi, /renderPointThead\(el, t,/)
  assert.doesNotMatch(hmi, /el\('table'[\s\S]{0,80}pointThead,/)
})

test('连接编辑器不再提供站号/单元字段', async () => {
  assert.doesNotMatch(hmi, /站号\/单元/)
  assert.doesNotMatch(hmi, /connForm\.conn\.slave/)
})
