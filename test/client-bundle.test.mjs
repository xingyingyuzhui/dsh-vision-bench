import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { pluginBodyOf, sha256Text } from '../scripts/build-client.mjs'
import { installDomStub } from './dom-stub.mjs'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')

test('generated client keeps the factory contract', async () => {
  const q = `['"]`
  assert.match(src, /Do not edit by hand/)
  assert.match(src, new RegExp(`id:\\s*${q}dsh-vision-bench${q}`))
  assert.match(src, /inject: \['slots', 'locale'\]/)
  assert.match(src, /apply: DvbClient\.apply/)
  assert.match(src, /var DvbClient =/)
  assert.doesNotMatch(src, /stripModule/)
  assert.match(src, /settings\.section/)
  assert.match(src, /conversation\.view/)
  assert.match(src, new RegExp(`id:\\s*${q}vision-bench-debug${q}`))
  assert.match(src, /dvb-split/)
  assert.match(src, new RegExp(`id:\\s*${q}vision-bench-hmi${q}`))
  assert.match(src, new RegExp(`id:\\s*${q}vision-bench-monitor${q}`))
  assert.match(src, new RegExp(`tabDebug:\\s*${q}调试${q}`))
  assert.match(src, new RegExp(`tabHmi:\\s*${q}上位机${q}`))
  assert.match(src, new RegExp(`tabMonitor:\\s*${q}监控${q}`))
  assert.match(src, /fs\/list/)
  assert.match(src, /keil\/build/)
  assert.match(src, /modbus\/read/)
  assert.match(src, /project\/file/)
  assert.match(src, /agentBuilding/)
  assert.match(src, /needBindingsBuild/)
  assert.match(src, /serial\/ports/)
  assert.match(src, /serialScan/)
  assert.match(src, /addSegment/)
  assert.match(src, /keil\/map/)
  assert.match(src, /projectMap/)
  assert.match(src, /include_edges/)
  assert.match(src, /后处理/)
  assert.doesNotMatch(src, new RegExp(`inject\\(\\s*\\[${q}betterSidebar${q}\\]`))
  assert.doesNotMatch(src, /side\.registerTab/)
  assert.match(src, /recipePair/)
  assert.match(src, /roleSlave/)
  assert.doesNotMatch(src, /priority: -10/)
  assert.match(src, /polling\/start/)
  assert.match(src, /polling\/stop/)
  assert.match(src, /liveStart/)
  assert.match(src, /modbus\/read/)
  assert.match(src, /setInterval/)
  assert.doesNotMatch(src, /还没有任务/)
  assert.doesNotMatch(src, /空载模拟/)
  assert.doesNotMatch(src, /下一刀/)
  assert.match(src, /ptEdit/)
  assert.match(src, new RegExp(`alarmOn:\\s*${q}告警${q}`))
  assert.match(src, /--dsh-composer-side-clearance/)
  assert.match(src, /寄存器段/)
  assert.doesNotMatch(src, /X-DSH-Vision-Bench/)
  assert.doesNotMatch(src, /^import /m)
  assert.doesNotMatch(src, /if \(data && data\.ok === false\) throw/)
  assert.match(src, /setError/)
  assert.match(src, /details\.log_file/)
  assert.match(src, /dsh-vision-bench\/state/)
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

test('generated client is valid JavaScript', async () => {
  const restore = installDomStub()
  try {
    assert.doesNotThrow(() => new Function('window', src))
  } finally {
    restore()
  }
})

test('generated client embeds real vendor runtime (uPlot + Virtualizer)', async () => {
  assert.match(src, /var DvbVendor = /)
  assert.match(src, /DvbVendorCss/)
  // no reliance on host globals for chart creation
  assert.doesNotMatch(src, /(?:window|globalThis)\.uPlot/)
  // uPlot official CSS present (not a hand-written substitute)
  assert.match(src, /\.u-legend|\.uplot|\.u-axis|u-legend-name/)
})

test('generated client contains exactly one ModuleLoader registration and no second React', async () => {
  const loads = src.match(/__ModuleLoader__\.load\(/g) || []
  assert.equal(loads.length, 1)
  // harness React comes from factory(require). Minified IIFE rewrites
  // require("react") through a local helper that still closes over require.
  assert.match(src, /factory\s*\(\s*require\s*\)/)
  assert.match(src, /typeof require/)
  assert.match(src, /\(\s*['"]react['"]\s*\)/)
  assert.doesNotMatch(src, /require\(['"]react-dom['"]\)/, 'must not require react-dom in the bundle')
  assert.doesNotMatch(src, /from\s+['"]react['"]/, 'should not contain a literal react import')
  assert.doesNotMatch(src, /node_modules\/react/, 'should not bundle React source')
  assert.doesNotMatch(src, /ReactDOM/, 'should not bundle ReactDOM')
})

test('build:check compares plugin body ignoring CRLF checkouts', () => {
  const crlf = src.replaceAll('\n', '\r\n')
  assert.notEqual(src, crlf)
  assert.equal(pluginBodyOf(src), pluginBodyOf(crlf))
  assert.equal(sha256Text(src), sha256Text(crlf))
  assert.match(src, /apply: DvbClient\.apply/)
})

test('client build no longer concatenates a parts array', async () => {
  const buildSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts/build-client.mjs'), 'utf8')
  assert.doesNotMatch(buildSrc, /function stripModule/)
  assert.doesNotMatch(buildSrc, /assertUniqueBindings/)
  assert.doesNotMatch(buildSrc, /const parts = \[/)
  assert.match(buildSrc, /src\/ui\/client\/client-entry\.mjs/)
})
