// Task1/0.19.3: 设备流程 — 点位归属；跨设备同地址允许。
// UI 空状态/校验/CSV 文案由 connection-presentation + point-editing RTL 覆盖。
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pointsOp } from '../../bench-modbus-forward.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'

const cfg = (id, port = 'COM3') => ({
  id,
  name: id,
  role: 'client',
  enabled: true,
  conn: { mode: 'rtu', port, baudrate: 9600, slave: 1, sim: true },
})

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
      values: [],
      alarmState: {},
      ...over,
    },
  })
  return { home, cwd }
}

test('设备1与设备2可以分别使用相同功能码和地址（HR0 两设备并存）', async () => {
  const { home, cwd } = await setup()
  const saved = loadWorkspace(home, cwd).modbus
  assert.equal(saved.points.filter((p) => p.address === 0).length, 2, '两个设备各有 HR0')
  await rm(home, { recursive: true, force: true })
})

test('编辑设备2的点位不会移动到设备1（pointsOp update 保持 deviceId）', async () => {
  const { home, cwd } = await setup()
  const ran = await pointsOp(home, cwd, { op: 'update', point: { id: 'p2', name: '改名', scale: 2 } })
  assert.equal(ran.ok, true)
  const saved = loadWorkspace(home, cwd).modbus
  const p2 = saved.points.find((p) => p.id === 'p2')
  assert.equal(p2.deviceId, 'd2', '归属设备保持不变')
  assert.equal(p2.connectionId, 'c1')
  assert.equal(p2.trendEnabled, true, '趋势标记保留')
  await rm(home, { recursive: true, force: true })
})
