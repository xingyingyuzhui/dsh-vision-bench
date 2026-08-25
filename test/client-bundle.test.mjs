import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { installDomStub } from './dom-stub.mjs'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')

test('generated client keeps the factory contract', () => {
  assert.match(src, /Do not edit by hand/)
  assert.match(src, /id: 'dsh-vision-bench'/)
  assert.match(src, /inject = \['slots'\]/)
  assert.match(src, /return module\.exports/)
  assert.match(src, /settings\.section/)
  assert.match(src, /conversation\.view/)
  assert.match(src, /id: 'vision-bench-debug'/)
  assert.match(src, /dvb-split/)
  assert.match(src, /id: 'vision-bench-hmi'/)
  assert.match(src, /tabDebug: '调试'/)
  assert.match(src, /tabHmi: '上位机'/)
  assert.match(src, /fs\/list/)
  assert.match(src, /keil\/build/)
  assert.match(src, /modbus\/read/)
  assert.match(src, /agentBuilding/)
  assert.match(src, /needBindingsBuild/)
  assert.match(src, /serial\/ports/)
  assert.match(src, /30000/)
  assert.match(src, /serialScan/)
  assert.match(src, /addSegment/)
  assert.match(src, /dsh-vision-bench:modbus/)
  assert.match(src, /dsh-vision-bench:project/)
  assert.match(src, /keil\/map/)
  assert.match(src, /projectMap/)
  assert.match(src, /include_edges/)
  assert.match(src, /后处理/)
  assert.match(src, /registerTab/)
  assert.match(src, /inject\(\['betterSidebar'\]/)
  assert.match(src, /recipePair/)
  assert.match(src, /roleSlave/)
  assert.doesNotMatch(src, /priority: -10/)
  // Task2/0.19.3: 客户端不再自持轮询循环；采集走 Host 服务路由
  assert.match(src, /polling\/start/)
  assert.match(src, /polling\/stop/)
  assert.match(src, /liveStart/)
  assert.match(src, /modbus\/read/)
  assert.match(src, /setInterval/)
  assert.doesNotMatch(src, /还没有任务/)
  assert.doesNotMatch(src, /空载模拟/)
  assert.doesNotMatch(src, /下一刀/)
  assert.match(src, /03 保持寄存器/)
  assert.match(src, /--dsh-composer-side-clearance/)
  assert.match(src, /寄存器段/)
  assert.match(src, /X-DSH-Vision-Bench/)
  assert.doesNotMatch(src, /^import /m)
  assert.doesNotMatch(src, /if \(data && data\.ok === false\) throw/)
  assert.match(src, /if \(data && data\.ok === false\) setError/)
  assert.match(src, /details\.log_file/)
  assert.match(src, /subscribeState/)
  assert.match(src, /STATE_BUS/)
  assert.match(src, /mapTruncated/)
  assert.doesNotMatch(src, /\.uvmpw \/ \.uvprojx/)
  assert.doesNotMatch(src, /\.uvprojx \/ \.uvmpw/)
  assert.doesNotMatch(src, /require\(['"]serialport['"]\)/)
  assert.doesNotMatch(src, /require\(['"]modbus-serial['"]\)/)
  assert.doesNotMatch(src, /from ['"]serialport['"]/)
  assert.doesNotMatch(src, /from ['"]modbus-serial['"]/)
  assert.doesNotMatch(src, /node_modules\/(serialport|modbus-serial)/)
  assert.doesNotMatch(src, /pythonReady \|\| sim/)
  assert.doesNotMatch(src, /healthReady\(health\.python\)/)
})

test('generated client is valid JavaScript', () => {
  const restore = installDomStub()
  try {
    assert.doesNotThrow(() => new Function('window', src))
  } finally { restore() }
})

test('generated client embeds real vendor runtime (uPlot + Virtualizer)', () => {
  assert.match(src, /var DvbVendor = /)
  assert.match(src, /DvbVendorCss/)
  // no reliance on host globals for chart creation
  assert.doesNotMatch(src, /(?:window|globalThis)\.uPlot/)
  // uPlot official CSS present (not a hand-written substitute)
  assert.match(src, /\.u-legend|\.uplot|\.u-axis|u-legend-name/)
})

test('generated client contains exactly one ModuleLoader registration and no second React', () => {
  const loads = src.match(/__ModuleLoader__\.load\(/g) || []
  assert.equal(loads.length, 1)
  // harness React comes from require('react'); react-virtual also requires it
  // (same harness React instance). No React SOURCE may be bundled, and there
  // must be no require('react-dom') at all (aliased flushSync shim).
  const reqReact = src.match(/require\(['"]react['"]\)/g) || []
  assert.ok(reqReact.length >= 1, 'harness react required at least once')
  assert.doesNotMatch(src, /require\(['"]react-dom['"]\)/, 'must not require react-dom in the bundle')
  assert.doesNotMatch(src, /from\s+['"]react['"]/, 'should not contain a literal react import')
  assert.doesNotMatch(src, /node_modules\/react/, 'should not bundle React source')
  assert.doesNotMatch(src, /ReactDOM/, 'should not bundle ReactDOM')
})
