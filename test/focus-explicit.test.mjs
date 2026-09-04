import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { requestFocus } from '../bench-modbus.mjs'
import { isForegroundTask, shouldStealFocus } from '../bench-shared.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'

test('Task14: 后台 read/poll 只更新角标 不抢焦点', async () => {
  assert.equal(isForegroundTask({ source: 'agent', type: 'read' }), false, 'agent read is background')
  assert.equal(isForegroundTask({ source: 'agent', type: 'poll' }), false, 'agent poll is background')
  assert.equal(isForegroundTask({ source: 'user', type: 'read' }), true)
  assert.equal(shouldStealFocus({ source: 'agent', type: 'read' }, { badgeOnly: false }), false)
  assert.equal(shouldStealFocus({ source: 'agent', type: 'read' }, { badgeOnly: true }), false)
  assert.equal(
    shouldStealFocus({ source: 'user', type: 'read' }, { badgeOnly: true }),
    false,
    'badgeOnly blocks even user',
  )
})

test('Task14: Agent focus 只有 foreground=true 才抢焦点 badgeOnly=true 不抢', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-focus14-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const p1 = {
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      name: 'T1',
      area: 'holdingRegister',
      function: 3,
      address: 0,
    }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
    const agentFocus = (extra) =>
      requestFocus(home, cwd, {
        source: 'agent',
        sessionId: 's-focus',
        target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
        ...extra,
      })
    // Agent focus without explicit foreground -> should be badgeOnly
    const noFg = await agentFocus({})
    assert.equal(noFg.ok, true)
    assert.equal(noFg.badgeOnly, true, 'agent focus without foreground must be badgeOnly')
    assert.equal(shouldStealFocus({ source: 'agent', type: 'read' }, noFg), false)
    // explicit foreground true -> not badgeOnly
    const fg = await agentFocus({ foreground: true })
    assert.equal(fg.ok, true)
    assert.equal(fg.badgeOnly, false, 'foreground=true should clear badgeOnly')
    const withSession = await agentFocus({ foreground: true })
    assert.equal(withSession.ok, true)
    assert.equal(withSession.sessionId, 's-focus')
    assert.equal(loadWorkspace(home, cwd).focus.sessionId, 's-focus')
    // badgeOnly true even with foreground true? badgeOnly wins
    const both = await agentFocus({ badgeOnly: true, foreground: true })
    assert.equal(both.ok, true)
    assert.equal(both.badgeOnly, true)
    // foreground false -> badgeOnly
    const fgFalse = await agentFocus({ foreground: false })
    assert.equal(fgFalse.ok, true)
    assert.equal(fgFalse.badgeOnly, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Task14: 返回原焦点 与 无效组合不产生半完成跳转', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-focus14-prev-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }
    const p1 = {
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      name: 'T1',
      area: 'holdingRegister',
      function: 3,
      address: 0,
    }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [p1] } })
    const first = await requestFocus(home, cwd, {
      source: 'agent',
      target: { connectionId: 'c1', pointId: 'p1' },
      foreground: true,
    })
    assert.equal(first.ok, true)
    const ws1 = loadWorkspace(home, cwd)
    assert.equal(ws1.focus.request.pointId, 'p1')
    assert.equal(ws1.focus.prev, null)
    const second = await requestFocus(home, cwd, {
      source: 'agent',
      target: { connectionId: 'c2', pointId: 'p1' },
      foreground: true,
    })
    // p1 belongs to c1, asking c2 + p1 should be TARGET_MISMATCH and not change focus
    assert.equal(second.ok, false)
    const ws2 = loadWorkspace(home, cwd)
    // focus should remain first, not half-set to c2
    assert.equal(ws2.focus.request.pointId, 'p1', 'invalid combo must not produce half jump')
    assert.equal(ws2.focus.request.connectionId, 'c1')
    // valid second focus to c2 pointless but with valid device? use without pointId
    const valid2 = await requestFocus(home, cwd, { source: 'agent', target: { connectionId: 'c2' }, foreground: true })
    assert.equal(valid2.ok, true)
    assert.equal(valid2.prev.pointId, 'p1', 'prev should be preserved')
    const ws3 = loadWorkspace(home, cwd)
    assert.equal(ws3.focus.prev.pointId, 'p1')
    assert.equal(ws3.focus.request.connectionId, 'c2')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
