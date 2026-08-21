import assert from 'node:assert/strict'
import test from 'node:test'
import { COPY, interpolate, translate } from '../bench-i18n.mjs'

test('zh and en tables share keys', () => {
  assert.deepEqual(Object.keys(COPY.zh).sort(), Object.keys(COPY.en).sort())
})

test('translate falls back and interpolates', () => {
  assert.equal(translate('zh', 'tabDebug'), '调试')
  assert.equal(translate('zh', 'projectMap'), '工程')
  assert.equal(translate('zh', 'mapOpen'), '结构')
  assert.equal(translate('zh', 'mapFunctions'), '函数')
  assert.equal(translate('zh', 'mapTruncated').includes('截断'), true)
  assert.match(translate('zh', 'pickerEmpty'), /\.uvprojx/)
  assert.doesNotMatch(translate('zh', 'pickerEmpty'), /uvmpw/)
  assert.equal(translate('zh', 'browse'), '选择工程')
  assert.equal(translate('zh', 'tabHmi'), '上位机')
  assert.equal(translate('zh', 'agentBuilding'), 'Agent 正在编译')
  assert.equal(translate('zh', 'needBindingsBuild'), '未绑定 Python / Keil UV4')
  assert.equal(translate('zh', 'serialPick'), '选择串口')
  assert.equal(translate('zh', 'serialScan'), '刷新')
  assert.equal(translate('zh', 'serialNone'), '未发现串口')
  assert.equal(translate('zh', 'addSegment'), '添加')
  assert.equal(translate('zh', 'segments'), '寄存器段')
  assert.equal(translate('zh', 'live'), '实时')
  assert.equal(translate('zh', 'statusCancelled'), '已取消')
  assert.equal(translate('zh', 'liveStart'), '监视')
  assert.equal(translate('zh', 'fnHolding'), '03 保持寄存器')
  assert.equal(translate('zh', 'liveClose'), '关闭')
  assert.equal(translate('zh', 'liveTable'), '点表')
  assert.equal(translate('zh', 'liveChart'), '曲线')
  assert.equal(translate('zh', 'recipePair'), '主从示例')
  assert.equal(translate('zh', 'roleSlave'), '从机')
  assert.equal(translate('en', 'tasks'), 'Tasks')
  assert.equal(translate('en', 'tabDebug'), 'Debug')
  assert.equal(interpolate('a {n} b', { n: 2 }), 'a 2 b')
  assert.equal(translate('zh', 'missing-key'), 'missing-key')
})
