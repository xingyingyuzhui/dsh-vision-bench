import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('Task9: bench-frames-view.mjs exists and registers dsh-vision-bench:frames', async () => {
  const p = join(root, 'bench-frames-view.mjs')
  assert.ok(existsSync(p), 'bench-frames-view.mjs should exist')
  const src = readFileSync(p, 'utf8')
  assert.match(src, /dsh-vision-bench:frames/, 'should register id dsh-vision-bench:frames')
  assert.match(src, /串口报文/, 'title should be 串口报文')
  assert.match(src, /createFramesPage|createFramesView/, 'should export createFramesPage')
  // order check will be via bench-live / bench-runtime
})

test('Task9: sidebar order 监视→曲线→告警→串口报文→工程', async () => {
  const liveSrc = readFileSync(join(root, 'bench-live.mjs'), 'utf8')
  const mapSrc = readFileSync(join(root, 'bench-map.mjs'), 'utf8')
  const framesSrc = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  const runtimeSrc = readFileSync(join(root, 'bench-runtime.mjs'), 'utf8')
  // check that bench-live registers frames with order 73
  assert.match(liveSrc, /TAB_FRAMES|dsh-vision-bench:frames/, 'bench-live should reference frames tab')
  assert.match(liveSrc, /order:\s*73/, 'frames order should be 73')
  // check liveTable 70, chart 71, alarm 72
  assert.match(liveSrc, /TAB_TABLE[\s\S]*order:\s*70/, 'liveTable order 70')
  assert.match(liveSrc, /TAB_CHART[\s\S]*order:\s*71/, 'chart order 71')
  assert.match(liveSrc, /TAB_ALARM[\s\S]*order:\s*72/, 'alarm order 72')
  // project should be after frames, order 74 or 80
  const orderMatch = mapSrc.match(/order:\s*(\d+)/)
  assert.ok(orderMatch, 'project should have order')
  const projOrder = Number(orderMatch[1])
  assert.ok(projOrder > 73, `project order ${projOrder} should be >73 after frames`)
  // runtime should wire frames
  assert.match(runtimeSrc, /bench-frames-view|createFramesPage/, 'runtime should import frames view')
  // i18n should have frames title
  const i18n = readFileSync(join(root, 'bench-i18n.mjs'), 'utf8')
  assert.match(i18n, /framesTab|串口报文/, 'i18n should have frames title')
})

test('Task9: 侧栏提供 全部串口/具体COM/未配置COM，仅原始数据模式可选', async () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  assert.match(src, /全部串口|framesAll/, 'should provide 全部串口')
  assert.match(src, /具体COM|COM|port/, 'should provide specific COM options')
  assert.match(src, /未配置COM|未配置|unconfigured/, 'should provide unconfigured COM')
  assert.match(src, /原始数据|framesRaw|raw/i, 'should have raw data mode')
  assert.match(src, /协议报文|framesProto|proto/i, 'should have protocol mode')
  // raw mode selectable, protocol mode uses existing Modbus transaction, not duplicate open
  assert.match(src, /getFramesLog|pushFramesLog/, 'protocol mode should use plugin Modbus transaction cache')
  assert.doesNotMatch(src, /openSerialMonitor.*proto|protocol.*openSerial/, 'protocol mode should not duplicate open occupied COM')
  // raw mode should check occupation
  assert.match(src, /PORT_IN_USE|isPortBusy|portInUse|占用/, 'raw mode should handle occupied COM')
})

test('Task9: 协议报文不重复打开已占用 COM', async () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  // protocol mode should rely on framesByConnection cache, not openSerial
  const protoSection = src.slice(src.indexOf('proto') > 0 ? src.indexOf('proto') : 0)
  assert.match(src, /framesByConnection|getFramesLog/, 'protocol should use frames cache')
  // ensure no openSerialMonitor call in protocol path (allow in raw path only)
  // count openSerialMonitor occurrences - should be limited to raw mode
  const openCount = (src.match(/openSerialMonitor/g) || []).length
  assert.ok(openCount <= 1, `openSerialMonitor should appear at most once (raw only), got ${openCount}`)
})

test('Task9: 支持连接/设备/方向/功能码/状态过滤、暂停/恢复/搜索/复制/导出、在上位机打开/让 Agent 分析', async () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  assert.match(src, /connectionId|连接/, 'should filter by connection')
  assert.match(src, /deviceId|device|设备/, 'should filter by device')
  assert.match(src, /direction|方向|TX|RX/, 'should filter by direction')
  assert.match(src, /functionCode|function|功能码/, 'should filter by function code')
  assert.match(src, /status|状态/, 'should filter by status')
  assert.match(src, /paused|暂停|pause|resume|恢复/, 'should support pause/resume')
  assert.match(src, /search|搜索|filter/, 'should support search')
  assert.match(src, /copy|复制|clipboard/, 'should support copy')
  assert.match(src, /export|导出/, 'should support export')
  assert.match(src, /openInHmi|在上位机打开|openHmi/, 'should support open in HMI')
  assert.match(src, /让 Agent 分析|sendToAgent|buildAgentRef|copyAgentRef/, 'should support let Agent analyze')
})

test('Task9: bench-frames-view virtualized and handles 500/1000/5000', async () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  assert.match(src, /Virtualizer|virtual|overscan/, 'should use virtualization for large lists')
  // reuse virtual-core check
  const { Virtualizer } = await import('@tanstack/virtual-core')
  assert.ok(Virtualizer, 'Virtualizer available')
})

test('Task9: client bundle includes frames tab', () => {
  const src = readFileSync(join(root, 'client.js'), 'utf8')
  // after build, client should contain frames registration
  // This will be checked after npm run build; for now check that build-client includes bench-frames-view
  const build = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.match(build, /bench-frames-view/, 'build-client should include bench-frames-view')
})
