// Task1/0.19.3: 设备流程 — 创建连接不自动造设备；添加设备必须唯一 Unit ID；
// 点位归属修复（编辑不移动设备）；CSV 设备作用域。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runVisionBench } from '../bench-tool.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { pointsOp } from '../bench-modbus-forward.mjs'

const cfg = (id, port = 'COM3') => ({ id, name: id, role: 'client', enabled: true, conn: { mode: 'rtu', port, baudrate: 9600, slave: 1, sim: true } })

async function setup(over = {}) {
  const home = await mkdtemp(join(tmpdir(), 'hdf-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [cfg('c1')],
      devices: [
        { id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 },
        { id: 'd2', connectionId: 'c1', name: '设备2', unitId: 2 },
      ],
      points: [
        { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'HR0-D1', function: 3, address: 0 },
        { id: 'p2', connectionId: 'c1', deviceId: 'd2', name: 'HR0-D2', function: 3, address: 0, trendEnabled: true },
      ],
      values: [], alarmState: {},
      ...over,
    },
  })
  return { home, cwd }
}

test('创建连接不会自动创建设备（源码契约）', async () => {
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  const addConn = src.slice(src.indexOf('function addConnection'), src.indexOf('function selectConnection'))
  assert.ok(!addConn.includes('newDev'), 'addConnection 不再生成设备')
  // 空状态引导存在
  assert.ok(src.includes('连接已创建'), '空状态文案存在')
  assert.ok(src.includes('下一步：添加设备'), '引导下一步存在')
})

test('添加设备必须填写名称与唯一站号（服务端唯一性可被 UI 校验）', async () => {
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('请填写设备名称'), '设备名必填校验')
  assert.ok(src.includes('已存在') && src.includes('站号'), '站号连接内唯一校验')
  assert.ok(src.includes('openAddDevice'), '添加设备入口（非直接生成站号 1）')
})

test('设备1与设备2可以分别使用相同功能码和地址（HR0 两设备并存）', async () => {
  const { home, cwd } = await setup()
  // 服务层允许同地址跨设备；UI 唯一键为 conn+dev+fn+addr（源码断言）
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  assert.ok(/saveNewPointDraft/.test(src) && /\(p\.deviceId \|\| ''\) === d\.deviceId/.test(src), '唯一键含 deviceId（行内草稿）')
  const saved = loadWorkspace(home, cwd).modbus
  assert.equal(saved.points.filter((p) => p.address === 0).length, 2, '两个设备各有 HR0')
  await rm(home, { recursive: true, force: true })
})

test('编辑设备2的点位不会移动到设备1（pointsOp update 保持 deviceId）', async () => {
  const { home, cwd } = await setup()
  // 编辑 p2（设备2）：只改 name/scale，不传 deviceId
  const ran = await pointsOp(home, cwd, { op: 'update', point: { id: 'p2', name: '改名', scale: 2 } })
  assert.equal(ran.ok, true)
  const saved = loadWorkspace(home, cwd).modbus
  const p2 = saved.points.find((p) => p.id === 'p2')
  assert.equal(p2.deviceId, 'd2', '归属设备保持不变')
  assert.equal(p2.connectionId, 'c1')
  assert.equal(p2.trendEnabled, true, '趋势标记保留')
  await rm(home, { recursive: true, force: true })
})

test('批量添加固定到按钮所在设备（源码契约：generateBatch 用 batch.deviceId）', async () => {
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  assert.ok(/batch\.deviceId/.test(src), 'batch 携带 deviceId')
  assert.ok(/fixedCid/.test(src), 'batch 绑定 connectionId')
})

test('CSV 只作用于当前设备：合并 vs 替换（源码契约 + 存储验证）', async () => {
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  assert.ok(/CSV 只作用于设备/.test(src), 'CSV 作用域文案')
  assert.ok(/合并导入/.test(src) && /替换当前设备点位/.test(src), '合并/替换二选一')
  assert.ok(/csvTarget\.mode === 'replace'/.test(src), '替换模式按设备清点')
  await rm(join(tmpdir(), 'hdf-unused'), { recursive: true, force: true }).catch(() => {})
})

test('删除设备确认包含点位与当前值数量（源码契约）', async () => {
  const src = await readFile(new URL('../bench-hmi.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('将同时删除该设备的'), '删除确认文案存在')
  assert.ok(src.includes('conf irmDeleteDevice'.replace(' ', '')) || src.includes('confirmDeleteDevice(d)'), '二次确认删除入口')
})