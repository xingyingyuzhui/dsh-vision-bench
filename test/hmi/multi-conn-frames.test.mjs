import assert from 'node:assert/strict'
import test from 'node:test'
import { clearFramesLog, getFramesLog, pushFramesLog } from '../../bench-shared.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench, createTempDir } from '../helpers/workspace-factory.mjs'
import { device, dualConnTopology, genFrames, rtuSim } from './multi-conn-fixtures.mjs'

test('framesByConnection 分轨：COM3 与 COM4 各自 500 环形互不串扰', async (t) => {
  const cwd = await createTempDir(t, 'dvb-frames-')
  clearFramesLog(cwd)
  assert.equal(getFramesLog(cwd, 'c1').length, 0)
  pushFramesLog(cwd, 'c1', genFrames('c1-', 600, 'c1'))
  pushFramesLog(cwd, 'c2', genFrames('c2-', 600, 'c2'))
  const c1 = getFramesLog(cwd, 'c1')
  const c2 = getFramesLog(cwd, 'c2')
  assert.equal(c1.length, 500)
  assert.equal(c2.length, 500)
  assert.ok(c1.every((f) => f.label.startsWith('c1-')))
  assert.ok(c2.every((f) => f.label.startsWith('c2-')))
  assert.equal(c1[0].label, 'c1-100')
  assert.equal(c2[0].label, 'c2-100')
  assert.equal(c1[c1.length - 1].label, 'c1-599')
  const all = getFramesLog(cwd, 'all')
  assert.equal(all.length, 500)
  clearFramesLog(cwd, 'c1')
  assert.equal(getFramesLog(cwd, 'c1').length, 0)
  assert.equal(getFramesLog(cwd, 'c2').length, 500)
  assert.equal(getFramesLog(cwd).length, 500)
  clearFramesLog(cwd)
  assert.equal(getFramesLog(cwd, 'c2').length, 0)
})

test('framesByConnection 500 环形：单独连接持续追加保持最新 500', async (t) => {
  const cwd = await createTempDir(t, 'dvb-frames2-')
  clearFramesLog(cwd)
  const gen = (n) =>
    Array.from({ length: n }, (_, i) => ({
      t: Date.now() + i,
      label: 'L' + i,
      request: 'R' + i,
      response: 'P' + i,
      trace: [],
    }))
  pushFramesLog(cwd, 'c1', gen(300))
  assert.equal(getFramesLog(cwd, 'c1').length, 300)
  pushFramesLog(cwd, 'c1', gen(300))
  assert.equal(getFramesLog(cwd, 'c1').length, 500)
  clearFramesLog(cwd)
})

test('framesByConnection 持久化：500 环形写入后隔离保存', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-frames-persist-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  const c2 = rtuSim('c2', 'COM4', { name: 'C2' })
  const fbc = { c1: genFrames('c1-', 600), c2: genFrames('c2-', 600) }
  bench.save({
    modbus: dualConnTopology({
      connections: [c1, c2],
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 1, 'D2')],
      framesByConnection: fbc,
    }),
  })
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.modbus.framesByConnection['c1'].length, 500)
  assert.equal(ws.modbus.framesByConnection['c2'].length, 500)
  assert.ok(ws.modbus.framesByConnection['c1'].every((f) => f.label.startsWith('c1-')))
  assert.ok(ws.modbus.framesByConnection['c2'].every((f) => f.label.startsWith('c2-')))
})
