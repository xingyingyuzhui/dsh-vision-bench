import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { COPY, interpolate, tWith, translate } from '../bench-i18n.mjs'

test('zh and en tables share keys', async () => {
  assert.deepEqual(Object.keys(COPY.zh).sort(), Object.keys(COPY.en).sort())
})

test('translate falls back and interpolates', async () => {
  assert.equal(translate('zh', 'tabDebug'), '调试')
  assert.equal(translate('zh', 'projectMap'), '工程结构')
  assert.equal(translate('zh', 'liveChart'), '可视化')
  assert.equal(translate('zh', 'mapOpen'), '打开工程结构')
  assert.equal(translate('zh', 'mapFunctions'), '函数')
  assert.equal(translate('zh', 'mapTruncated').includes('截断'), true)
  assert.match(translate('zh', 'pickerEmpty'), /\.uvprojx/)
  assert.doesNotMatch(translate('zh', 'pickerEmpty'), /uvmpw/)
  assert.equal(translate('zh', 'browse'), '选择工程')
  assert.equal(translate('zh', 'tabHmi'), '上位机')
  assert.equal(translate('zh', 'tabMonitor'), '监控')
  assert.equal(translate('zh', 'sectionWorkbench'), '工作台')
  assert.equal(translate('zh', 'agentBuilding'), 'Agent 正在编译')
  assert.equal(translate('zh', 'needBindingsBuild'), '未绑定 Python / Keil UV4')
  assert.equal(translate('zh', 'ioRuntime').includes('Modbus'), true)
  assert.equal(translate('zh', 'shareTitle'), '工作区共享')
  assert.equal(translate('en', 'shareTitle'), 'Workspace sharing')
  assert.equal(translate('zh', 'shareMaster'), '共享到工作区')
  assert.equal(translate('en', 'shareConnections'), 'Connections and devices')
  assert.equal(translate('zh', 'framesTcpNormalized'), '协议归一化报文')
  assert.match(translate('zh', 'framesRawHint'), /原始串口字节流/)
  assert.equal(translate('zh', 'ioPending'), '待启动')
  assert.match(translate('zh', 'framesProtoHint'), /Modbus 事务报文/)
  assert.equal(translate('zh', 'serialPick'), '选择串口')
  assert.equal(translate('zh', 'serialScan'), '刷新')
  assert.equal(translate('zh', 'serialNone'), '未发现串口')
  assert.equal(translate('zh', 'addSegment'), '添加')
  assert.equal(translate('zh', 'segments'), '寄存器段')
  assert.equal(translate('zh', 'live'), '实时')
  assert.equal(translate('zh', 'statusCancelled'), '已取消')
  assert.equal(translate('zh', 'liveStart'), '监视')
  assert.equal(translate('zh', 'fnHolding'), '03')
  assert.equal(translate('zh', 'alarmOn'), '告警')
  assert.equal(translate('zh', 'ptEdit'), '编辑点位')
  assert.equal(translate('zh', 'devSave'), '保存')
  assert.equal(translate('zh', 'liveClose'), '关闭')
  assert.equal(translate('zh', 'liveTable'), '监视')
  assert.equal(translate('zh', 'liveChart'), '可视化')
  assert.equal(translate('zh', 'recipePair'), '主从示例')
  assert.equal(translate('zh', 'roleSlave'), '从机')
  assert.equal(translate('en', 'tasks'), 'Tasks')
  assert.equal(translate('en', 'tabDebug'), 'Debug')
  assert.equal(translate('en', 'tabMonitor'), 'Monitor')
  assert.equal(interpolate('a {n} b', { n: 2 }), 'a 2 b')
  assert.equal(translate('zh', 'missing-key'), 'missing-key')
})

test('tWith falls back to COPY when locale is not injected', () => {
  assert.equal(tWith({}, 'tabHmi'), '上位机')
  assert.equal(tWith({ locale: null }, 'tabDebug'), '调试')
})

test('tWith uses locale.bind when the locale service is present', () => {
  const ctx = {
    locale: {
      bind: () => (key) => (key === 'tabHmi' ? 'HMI from locale' : key),
    },
  }
  assert.equal(tWith(ctx, 'tabHmi'), 'HMI from locale')
})

test('client inject lists slots, locale, connection and matches the package manifest', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-connection',
  ])
  const entry = readFileSync(join(root, 'src/ui/client/client-entry.mjs'), 'utf8')
  assert.match(entry, /inject = \['slots', 'locale', 'connection'\]/)
  const build = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.match(build, /inject: \['slots', 'locale', 'connection'\]/)
})
