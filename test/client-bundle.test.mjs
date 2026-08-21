import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')

test('generated client keeps the factory contract', () => {
  assert.match(src, /Do not edit by hand/)
  assert.match(src, /id: 'dsh-vision-bench'/)
  assert.match(src, /inject = \['slots'\]/)
  assert.match(src, /return module\.exports/)
  assert.match(src, /settings\.section/)
  assert.match(src, /conversation\.view/)
  assert.match(src, /id: 'vision-bench-debug'/)
  assert.match(src, /id: 'vision-bench-hmi'/)
  assert.match(src, /tabDebug: '调试'/)
  assert.match(src, /tabHmi: '上位机'/)
  assert.match(src, /fs\/list/)
  assert.match(src, /keil\/build/)
  assert.match(src, /modbus\/read/)
  assert.match(src, /agentBuilding/)
  assert.match(src, /needBindingsBuild/)
  assert.match(src, /serialPh/)
  assert.match(src, /serial\/ports/)
  assert.match(src, /serialScan/)
  assert.match(src, /addSegment/)
  assert.match(src, /pointTable/)
  assert.match(src, /dsh-vision-bench:modbus/)
  assert.match(src, /registerTab/)
  assert.match(src, /inject\(\['betterSidebar'\]/)
  assert.match(src, /recipePair/)
  assert.match(src, /roleSlave/)
  assert.doesNotMatch(src, /priority: -10/)
  assert.match(src, /modbus\/poll/)
  assert.match(src, /liveStart/)
  assert.match(src, /simOff/)
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
})

test('generated client is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('window', src))
})
