import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  emptyBindings,
  emptyWorkspace,
  loadBindings,
  loadWorkspace,
  normalizeBindings,
  normalizeWorkspace,
  probeBindings,
  saveBindings,
  saveWorkspace,
  validateBindings,
} from '../bench-store.mjs'

test('normalizeBindings keeps only python/uv4/openocd strings', () => {
  assert.deepEqual(normalizeBindings(null), emptyBindings())
  assert.deepEqual(normalizeBindings({ python: ' /bin/python3 ', extra: 1, uv4: 3 }), {
    python: '/bin/python3',
    uv4: '',
    openocd: '',
  })
})

test('validateBindings rejects relative paths', () => {
  assert.deepEqual(validateBindings(emptyBindings()), [])
  assert.ok(validateBindings({ python: 'python3', uv4: '', openocd: '' }).length > 0)
})

test('probeBindings reports unbound vs missing vs ready', () => {
  const exists = (p) => p === '/bin/python3'
  const health = probeBindings({ python: '/bin/python3', uv4: '/no/uv4', openocd: '' }, exists)
  assert.deepEqual(health.python, { bound: true, exists: true })
  assert.deepEqual(health.uv4, { bound: true, exists: false })
  assert.deepEqual(health.openocd, { bound: false, exists: false })
})

test('saveBindings writes absolute paths under the home store', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-'))
  try {
    const abs = join(home, 'python')
    const saved = saveBindings(home, { python: abs, uv4: '', openocd: '' })
    assert.equal(saved.ok, true)
    assert.equal(saved.bindings.python, abs)
    const disk = JSON.parse(await readFile(join(home, 'vision-bench', 'bindings.json'), 'utf8'))
    assert.equal(disk.python, abs)
    assert.deepEqual(loadBindings(home).python, abs)
    const rejected = saveBindings(home, { python: 'python3' })
    assert.equal(rejected.ok, false)

    const cwd = join(home, 'proj')
    const savedWs = saveWorkspace(home, cwd, {
      keil: { project: join(cwd, 'a.uvprojx'), target: 'Debug' },
      modbus: { mode: 'tcp', host: '127.0.0.1', function: 3, address: 10 },
    })
    assert.equal(savedWs.ok, true)
    assert.equal(savedWs.workspace.keil.target, 'Debug')
    assert.equal(savedWs.workspace.log[0].action, 'select-project')
    assert.equal(savedWs.workspace.timeline[0].kind, 'select-project')
    assert.deepEqual(savedWs.workspace.tasks, [])
    assert.equal(savedWs.workspace.modbus.mode, 'tcp')
    assert.equal(loadWorkspace(home, cwd).modbus.address, 10)
    assert.equal(normalizeWorkspace(null).modbus.function, emptyWorkspace().modbus.function)
    assert.deepEqual(emptyWorkspace().tasks, [])
    assert.deepEqual(emptyWorkspace().timeline, [])
    assert.deepEqual(emptyWorkspace().modbus.segments, [])
    assert.deepEqual(emptyWorkspace().modbus.values, [])
    assert.equal(emptyWorkspace().modbus.polling.enabled, false)
    assert.equal(emptyWorkspace().modbus.sim, false)
    assert.ok(Array.isArray(emptyWorkspace().modbus.devices))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('P0/0.20.0: visualization round-trip, configVersion bump, old workspace migration', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = await mkdtemp(join(tmpdir(), 'store-viz-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  // 旧工作区：trendEnabled 点位 + 无 visualization
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: '旧', function: 3, address: 0, trendEnabled: true, alarmMin: 10 }],
      values: [], alarmState: {},
    },
  })
  const w1 = loadWorkspace(home, cwd)
  assert.equal(w1.modbus.points[0].monitorEnabled, true, '旧 trendEnabled → monitorEnabled')
  assert.equal(w1.modbus.points[0].alarmEnabled, true, '旧阈值 → alarmEnabled')
  assert.deepEqual(w1.modbus.visualization, { schemaVersion: 1, components: [] }, '无 visualization 默认空')

  // 保存组件 → configVersion 递增
  const cv1 = w1.modbus.configVersion
  const saved = saveWorkspace(home, cwd, {
    modbus: {
      visualization: { schemaVersion: 1, components: [{ id: 'viz_1', name: '趋势', type: 'line', pointIds: ['p1'] }] },
      version: 3,
    },
  })
  assert.equal(saved.ok, true)
  const w2 = loadWorkspace(home, cwd)
  assert.equal(w2.modbus.visualization.components.length, 1)
  assert.equal(w2.modbus.visualization.components[0].name, '趋势')
  assert.ok(w2.modbus.configVersion > cv1, '组件修改递增 configVersion: ' + cv1 + ' -> ' + w2.modbus.configVersion)

  // 组件编辑再次递增
  const cv2 = w2.modbus.configVersion
  saveWorkspace(home, cwd, {
    modbus: {
      visualization: { schemaVersion: 1, components: [{ id: 'viz_1', name: '趋势2', type: 'line', pointIds: ['p1'], settings: { windowMs: 120000 } }] },
      version: 3,
    },
  })
  const w3 = loadWorkspace(home, cwd)
  assert.ok(w3.modbus.configVersion > cv2, '组件编辑再次递增 configVersion')
  assert.equal(w3.modbus.visualization.components[0].name, '趋势2')
  await rm(home, { recursive: true, force: true })
})
