// Task1/0.18.4: pure focus-routing decisions — active cwd gate, badgeOnly and
// foreground gates, routeKey dedup incl. cwd, and kind→tab mapping.
import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRouteFocus } from '../bench-shared.mjs'

const focus = (over = {}) => ({
  request: {
    connectionId: 'c1',
    deviceId: 'd1',
    ...over.request,
  },
  badgeOnly: false,
  ...over,
})

test('active=A, A foreground frame → opens frames once', async () => {
  const f = focus({ request: { frameId: 'f1', connectionId: 'c1' } })
  const d1 = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  assert.equal(d1.route, true)
  assert.equal(d1.tab, 'frames')
  assert.equal(d1.viewId, 'vision-bench-monitor')
  assert.equal(d1.section, 'frames')
  assert.ok(d1.routeKey.includes('/w/a'))
  // identical target polled again → no re-route
  const d2 = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: d1.routeKey })
  assert.equal(d2.route, false)
  assert.equal(d2.routeKey, d1.routeKey)
})

test('same cwd different Session Focus does not steal the current page', async () => {
  const f = focus({ sessionId: 'sA', request: { frameId: 'f1', connectionId: 'c1' } })
  const d = shouldRouteFocus({
    activeCwd: '/w/shared',
    activeSessionId: 'sB',
    changedCwd: '/w/shared',
    focus: f,
    previousRouteKey: '',
  })
  assert.equal(d.route, false)
})

test('active=A, a B foreground alarm → no route', async () => {
  const f = focus({ request: { alarmId: 'a1', connectionId: 'c2' } })
  const d = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/b', focus: f, previousRouteKey: '' })
  assert.equal(d.route, false)
  assert.equal(d.tab, '')
})

test('active=A, A badgeOnly → no route', async () => {
  const f = focus({ badgeOnly: true, request: { frameId: 'f1', connectionId: 'c1' } })
  const d = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  assert.equal(d.route, false)
})

test('active=A, A same focus repeated 10× → routes exactly once', async () => {
  const f = focus({ request: { trendKey: 'c1:d1:p1' } })
  let prev = ''
  let routed = 0
  for (let i = 0; i < 10; i++) {
    const d = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: prev })
    if (d.route) routed++
    prev = d.routeKey || prev
  }
  assert.equal(routed, 1)
  // kind trend maps to trend tab on the single route
  const first = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  assert.equal(first.tab, 'trend')
})

test('active switches A→B: A events ignored, B events take effect', async () => {
  const fA = focus({ request: { frameId: 'fA', connectionId: 'c1' } })
  const fB = focus({ request: { alarmId: 'aB', connectionId: 'c2' } })
  const dA = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: fA, previousRouteKey: '' })
  assert.equal(dA.tab, 'frames')
  // now active = B; A's stale frame focus must NOT switch the sidebar
  const dA2 = shouldRouteFocus({ activeCwd: '/w/b', changedCwd: '/w/a', focus: fA, previousRouteKey: dA.routeKey })
  assert.equal(dA2.route, false)
  // B's alarm focus routes once
  const dB = shouldRouteFocus({ activeCwd: '/w/b', changedCwd: '/w/b', focus: fB, previousRouteKey: '' })
  assert.equal(dB.route, true)
  assert.equal(dB.tab, 'alarm')
})

test('A and B sharing the same pointId never cross-judge', async () => {
  const f = focus({ request: { pointId: 'p1', connectionId: 'c1', deviceId: 'd1' } })
  const dA = shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: f, previousRouteKey: '' })
  const keyA = dA.routeKey
  const dB = shouldRouteFocus({ activeCwd: '/w/b', changedCwd: '/w/b', focus: f, previousRouteKey: '' })
  assert.notEqual(dB.routeKey, keyA, 'routeKey must include cwd')
  assert.equal(dB.tab, 'table')
})

test('kind mapping: point/connection/device→table, trend→trend, alarm→alarm, frame→frames', async () => {
  const pointRoute = shouldRouteFocus({
    activeCwd: '/w/a',
    changedCwd: '/w/a',
    focus: focus({ request: { pointId: 'p' } }),
    previousRouteKey: '',
  })
  assert.equal(pointRoute.tab, 'table')
  assert.equal(pointRoute.viewId, 'vision-bench-hmi')
  assert.equal(
    shouldRouteFocus({
      activeCwd: '/w/a',
      changedCwd: '/w/a',
      focus: focus({ request: { pointId: 'p' } }),
      previousRouteKey: '',
    }).tab,
    'table',
  )
  assert.equal(
    shouldRouteFocus({
      activeCwd: '/w/a',
      changedCwd: '/w/a',
      focus: focus({ request: { connectionId: 'c' } }),
      previousRouteKey: '',
    }).tab,
    'table',
  )
  assert.equal(
    shouldRouteFocus({
      activeCwd: '/w/a',
      changedCwd: '/w/a',
      focus: focus({ request: { trendKey: 'c:d:p' } }),
      previousRouteKey: '',
    }).tab,
    'trend',
  )
  assert.equal(
    shouldRouteFocus({
      activeCwd: '/w/a',
      changedCwd: '/w/a',
      focus: focus({ request: { alarmId: 'a' } }),
      previousRouteKey: '',
    }).tab,
    'alarm',
  )
  assert.equal(
    shouldRouteFocus({
      activeCwd: '/w/a',
      changedCwd: '/w/a',
      focus: focus({ request: { frameId: 'f' } }),
      previousRouteKey: '',
    }).tab,
    'frames',
  )
})

test('no activeCwd / no request / foreground=false never route', async () => {
  assert.equal(
    shouldRouteFocus({ activeCwd: '', changedCwd: '/w/a', focus: focus({}), previousRouteKey: '' }).route,
    false,
  )
  assert.equal(
    shouldRouteFocus({ activeCwd: '/w/a', changedCwd: '/w/a', focus: {}, previousRouteKey: '' }).route,
    false,
  )
  assert.equal(
    shouldRouteFocus({
      activeCwd: '/w/a',
      changedCwd: '/w/a',
      focus: focus({ foreground: false }),
      previousRouteKey: '',
    }).route,
    false,
  )
})
test('P4/0.20.0: visualizationId routes to the charts tab (trend bucket)', async () => {
  const fs = { request: { visualizationId: 'viz_1', kind: 'visualization' }, badgeOnly: false }
  const d1 = shouldRouteFocus({ activeCwd: 'A', changedCwd: 'A', focus: fs, previousRouteKey: '' })
  assert.equal(d1.route, true)
  assert.equal(d1.tab, 'trend', 'visualization 路由到 charts tab')
  assert.equal(d1.viewId, 'vision-bench-monitor')
  assert.equal(d1.section, 'visualization')
  const d2 = shouldRouteFocus({ activeCwd: 'A', changedCwd: 'A', focus: fs, previousRouteKey: d1.routeKey })
  assert.equal(d2.route, false, '同一 visualizationId 去重')
})

test('Task5/6/0.20.1: visualizationId 聚焦链路 — 仅传组件 ID 即解析（不要求 connectionId）', async () => {
  const { resolveTarget } = await import('../bench-targets.mjs')
  const pack = {
    version: 3,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
    devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
    points: [
      { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: '温度', function: 3, address: 0, monitorEnabled: true },
    ],
    visualization: { schemaVersion: 1, components: [{ id: 'viz_a', name: '趋势图', type: 'line', pointIds: ['p1'] }] },
  }
  const rt = resolveTarget(pack, { visualizationId: 'viz_a' })
  assert.equal(rt.ok, true, '仅 visualizationId 解析成功')
  assert.equal(rt.visualizationId, 'viz_a')
  assert.equal(rt.visualization.name, '趋势图')
  const missing = resolveTarget(pack, { visualizationId: 'viz_nope' })
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'VIZ_NOT_FOUND')
})

test('requestFocus 缺失组件保留 VIZ_NOT_FOUND（不退化 TARGET_MISMATCH）', async () => {
  const { mkdtemp, rm, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { requestFocus } = await import('../bench-modbus.mjs')
  const { saveWorkspace } = await import('../bench-store.mjs')
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-focus-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
        devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
        points: [],
        visualization: { schemaVersion: 1, components: [] },
      },
    })
    const miss = await requestFocus(home, cwd, { visualizationId: 'viz_gone', kind: 'visualization' })
    assert.equal(miss.ok, false)
    assert.equal(miss.errorCode, 'VIZ_NOT_FOUND')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Task6/0.20.1: 不同工作区相同组件 ID 不串扰（subscribeFocus 按 cwd 订阅）', async () => {
  const { setFocusState } = await import('../bench-shared.mjs')
  let gotA = null
  let gotB = null
  const unA = (await import('../bench-shared.mjs')).subscribeFocus('wsA', (fs) => {
    gotA = fs && fs.request
  })
  const unB = (await import('../bench-shared.mjs')).subscribeFocus('wsB', (fs) => {
    gotB = fs && fs.request
  })
  setFocusState('wsA', { request: { visualizationId: 'same_viz', kind: 'visualization' } })
  assert.equal(gotA && gotA.visualizationId, 'same_viz', 'A 收到')
  assert.equal(gotB, null, 'B 不收 A 的焦点')
  setFocusState('wsB', { request: { visualizationId: 'same_viz', kind: 'visualization' } })
  assert.equal(gotB && gotB.visualizationId, 'same_viz')
  unA()
  unB()
})
