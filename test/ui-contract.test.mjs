// Task7+8+9+10/0.19.2: UI contract — bind UI gone, focus banner gone, timeline
// moved to sidebar, single shared value store drives table/monitor/trend/alarm.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { modbusPoll } from '../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'

const src = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8')
async function hmiBundle() {
  const { readdir } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = join(root, 'src/ui/hmi')
  const files = await readdir(dir)
  const parts = await Promise.all(
    files
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => readFile(new URL('../src/ui/hmi/' + f, import.meta.url), 'utf8')),
  )
  return parts.join('\n')
}
async function stylesBundle() {
  const files = [
    'bench-styles.mjs',
    'src/ui/styles/base.mjs',
    'src/ui/styles/hmi.mjs',
    'src/ui/styles/sidebar.mjs',
    'src/ui/styles/visualization.mjs',
    'src/ui/styles/frames.mjs',
    'src/ui/styles/table.mjs',
    'src/ui/styles/workspace.mjs',
  ]
  const parts = await Promise.all(files.map((f) => src(f)))
  return parts.join('\n')
}

test('页面契约：无绑定 UI、无大块聚焦面板、无完整时间线、无“打开串口”按钮', async () => {
  const [hmi, view, shared, live, frames, styles] = await Promise.all([
    hmiBundle(),
    src('bench-view.mjs'),
    src('bench-shared.mjs'),
    src('src/ui/monitor/alarms/alarm-page.mjs'),
    src('src/ui/monitor/frames/frames-page.mjs'),
    stylesBundle(),
  ])
  // Task7: bind UI gone
  for (const f of [hmi, view, shared]) {
    assert.ok(!/session\/bind/.test(f), 'no bind route call in UI source')
    assert.ok(!/t\('bindOn'\)|t\('bindOff'\)/.test(f), 'no bind button labels')
  }
  // Task8: focus banner gone (no large panel, no per-row 聚焦 buttons)
  assert.ok(!/dvb-focus-banner/.test(hmi), 'no focus banner in hmi')
  assert.ok(!/dvb-focus-banner/.test(live), 'no focus banner in live')
  assert.ok(!/requestFocusUi\([^)]*kind: 'connection'/.test(hmi), 'no per-connection 聚焦 button')
  // toast kept as the lightweight notice（侧栏监视已删，toast 只在上位机）
  assert.ok(/dvb-focus-toast/.test(hmi), 'transient focus toast present in HMI')
  assert.ok(/dvb-focus-toast/.test(styles), 'toast styles present')
  // Task9: full journal timeline removed from debug/hmi pages
  assert.ok(!/journalPanel\(el, t, journal\)/.test(hmi), 'hmi has no full timeline panel')
  assert.ok(!/journalPanel\(el, t, journal\)/.test(view), 'debug has no full timeline panel')
  const journal = await src('src/ui/monitor/journal/journal-page.mjs')
  assert.ok(/createLogPage/.test(journal), 'operation log page exists')
  const runtime = await src('bench-runtime.mjs')
  assert.ok(!/betterSidebar/.test(runtime), 'runtime no longer injects betterSidebar')
  assert.ok(/source: 'agent'/.test(runtime), 'Agent focus navigates as agent source')
  assert.doesNotMatch(runtime, /slots\.select|setNavViewSelector/, 'runtime uses openView, not slots.select')
  const viewReq = await src('src/ui/workspace/vision-view-request.mjs')
  assert.ok(/applied === false/.test(viewReq), 'Agent focus respects manual nav lease')
  assert.ok(/mode: 'badge'/.test(viewReq), 'lease-blocked Agent requests stay as badges')
  const monitor = await src('src/ui/workspace/monitor-workspace.mjs')
  assert.ok(/MONITOR_SECTIONS/.test(monitor), 'monitor workspace owns sections')
  const debugWs = await src('src/ui/workspace/debug-workspace.mjs')
  assert.ok(/DEBUG_SECTIONS/.test(debugWs), 'debug workspace owns sections')
  assert.ok(!/LOG:\s*'log'/.test(debugWs), 'build log stays in workbench, not a debug section')
  // Task4.3: frames page never opens a port
  assert.ok(!/\/connection\/open/.test(frames), 'frames page has no open-port call')
  assert.ok(!/打开串口/.test(frames), 'frames page has no 打开串口 button text')
  // Task1/0.19.3: “参与运行”不再是公开概念（旧 enabled 仅读取兼容）
  assert.ok(!/connParticipate/.test(hmi), 'no 参与运行 in HMI source')
  // Task1/0.19.3: 设备卡片层级（点位表挂在设备卡片内部）
  assert.ok(/dvb-dev-card/.test(hmi), 'device cards exist')
  assert.ok(/addNewPointRow\(d\.id\)/.test(hmi), 'add-point opens per device (inline draft row)')
  assert.ok(/pointsOfDevice/.test(hmi), 'point tables are device-scoped')
  // 阶段四：上位机不再嵌入串口报文卡片
  assert.ok(!/查看全部报文/.test(hmi), 'no frames card in HMI')
  assert.ok(!/serialPanel/.test(hmi), 'no serialPanel in HMI')
  // Task2: 采集按钮（开始采集/停止采集）而不使用“监视”措辞
  assert.ok(/collectStart/.test(hmi) && /collectStop/.test(hmi), 'collection buttons present')
  // TaskP1/0.20.0: 点位表 — 无 更新时间 列；普通状态无 写入/读取/编辑/删除 文字按钮
  assert.ok(!/el\('th', null, t\('time'\)\)/.test(hmi), 'no 更新时间 column')
  assert.ok(!/t\('quickWrite'\)/.test(hmi), 'no 写入 text button')
  assert.ok(!/t\('readSegment'\)/.test(hmi), 'no 读取 text button per row')
  assert.ok(!/t\('editing'\)\.slice\(0, 2\)/.test(hmi), 'no 编辑 text button per row')
  assert.ok(!/t\('deleteSegment'\)/.test(hmi), 'no 删除 text button (edit mode only, icon)')
  // 行内写入；点位状态改在设备头（仍复用 pointRuntimeStatus）
  assert.ok(/openWriteCell/.test(hmi), 'current-value inline write')
  assert.ok(/pointRuntimeStatus/.test(hmi), 'device status via pointRuntimeStatus')
  assert.ok(!/dvb-col-status/.test(hmi), 'no per-point status column')
  assert.ok(/dvb-switch/.test(hmi), 'monitor/alarm switches')
  assert.ok(/dvb-btn-danger/.test(hmi), 'edit-mode danger icon')
})

test('Task10: 一次读取同步进入 点表值/监视/曲线/告警（单一实时值来源）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uc-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        {
          id: 'c1',
          name: 'C1',
          role: 'client',
          enabled: true,
          conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true },
        },
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '温度',
          function: 3,
          address: 0,
          count: 1,
          active: true,
          watched: true,
          alarmMin: 60,
          alarmMax: 80,
        },
      ],
      values: [],
      alarmState: {},
      pollPlan: { auto: true, connections: {} },
    },
  })
  // a single agent read lands in the shared values store
  const ran = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, true)
  const ws = loadWorkspace(home, cwd).modbus
  // 点表当前值（点表/监视/曲线全部读同一 values 快照）
  const rec = (ws.values || []).find((v) => v.key === 'p1' || v.pointId === 'p1')
  assert.ok(rec && rec.value != null, 'point table current value updated: ' + JSON.stringify(rec && rec.value))
  // 监视/曲线消费同一 values 快照（points 动作返回的点行即同一时刻的同一存储记录）
  const list = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, { source: 'agent', sessionId: 's1' })
  const prow = ((list && list.points) || []).find((p) => p.id === 'p1')
  assert.ok(prow && prow.value != null, 'agent points view carries the shared current value')
  const wsAfter = loadWorkspace(home, cwd).modbus
  const recAfter = (wsAfter.values || []).find((v) => v.key === 'p1' || v.pointId === 'p1')
  assert.equal(prow.value, recAfter && recAfter.value, 'points view and value store agree at the same moment')
  // 告警由同一 values 驱动：越限触发 → 回到带内恢复
  let alarm = loadWorkspace(home, cwd).modbus.alarmActive || {}
  assert.ok(
    Object.keys(alarm).length > 0,
    'over-limit value triggered alarm from shared flow: ' + JSON.stringify(alarm),
  )
  await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [70] },
    cwd,
    { source: 'manual', sessionId: '' },
  )
  alarm = loadWorkspace(home, cwd).modbus.alarmActive || {}
  const rec2 = alarm.p1 || alarm['p1']
  assert.ok(!rec2 || rec2.status === 'recovered', 'back-in-band value recovered the alarm: ' + JSON.stringify(alarm))
  await rm(home, { recursive: true, force: true })
})

test('Task10: 轮询环路每 cwd 只有一条（并发触发返回 skipped busy，不叠加）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uc2-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        {
          id: 'c1',
          name: 'C1',
          role: 'client',
          enabled: true,
          conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true },
        },
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '温度',
          function: 3,
          address: 0,
          count: 1,
          active: true,
          watched: true,
        },
      ],
      values: [],
      alarmState: {},
      pollPlan: { auto: true, connections: {} },
    },
  })
  // fire two polling loops at once: the second must be skipped as busy —
  // 点表/监视/曲线/告警 不会因为多页面各开一条轮询
  const [a1, busy] = await Promise.all([
    modbusPoll(home, cwd, { budgetMs: 120 }),
    modbusPoll(home, cwd, { budgetMs: 120 }),
  ])
  assert.equal(a1.ok, true)
  assert.ok(
    busy.skipped === true || busy.busy === true || busy.error === '无可用连接',
    'duplicate loop must not stack: ' + JSON.stringify(busy && { skipped: busy.skipped, busy: busy.busy }),
  )
  await rm(home, { recursive: true, force: true })
})
