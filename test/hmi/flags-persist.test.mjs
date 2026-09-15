import assert from 'node:assert/strict'
import test from 'node:test'
import { baseMb, flagHarness } from '../helpers/hmi-page-fixtures.mjs'


test('监视失败不得把已成功的告警回滚掉', async () => {
  let resolveMon
  let resolveAlm
  const post = async (_path, body) => {
    if (body.monitorEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveMon = resolve
      })
    }
    if (body.alarmEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveAlm = resolve
      })
    }
    return { ok: true }
  }
  const h = flagHarness({ post })
  const mon = h.actions.persistPointFlags('p1', { monitorEnabled: true })
  const alm = h.actions.persistPointFlags('p1', { alarmEnabled: true })
  await new Promise((r) => setTimeout(r, 10))
  resolveAlm({
    ok: true,
    point: { id: 'p1', monitorEnabled: true, alarmEnabled: true, trendEnabled: true },
  })
  await alm
  resolveMon({ ok: false, error: 'monitor failed' })
  await mon
  assert.equal(h.point.monitorEnabled, false)
  assert.equal(h.point.alarmEnabled, true)
  const rollback = [...h.flagPatches].reverse().find((p) => p.monitorEnabled === false)
  assert.ok(rollback, '监视失败应回滚监视')
  assert.equal(Object.prototype.hasOwnProperty.call(rollback, 'alarmEnabled'), false)
})

test('告警失败不得把已成功的监视回滚掉', async () => {
  let resolveMon
  let resolveAlm
  const post = async (_path, body) => {
    if (body.monitorEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveMon = resolve
      })
    }
    if (body.alarmEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveAlm = resolve
      })
    }
    return { ok: true }
  }
  const h = flagHarness({ post })
  const mon = h.actions.persistPointFlags('p1', { monitorEnabled: true })
  const alm = h.actions.persistPointFlags('p1', { alarmEnabled: true })
  await new Promise((r) => setTimeout(r, 10))
  resolveMon({
    ok: true,
    point: { id: 'p1', monitorEnabled: true, alarmEnabled: false, trendEnabled: true },
  })
  await mon
  resolveAlm({ ok: false, error: 'alarm failed' })
  await alm
  assert.equal(h.point.monitorEnabled, true)
  assert.equal(h.point.trendEnabled, true)
  assert.equal(h.point.alarmEnabled, false)
  const rollback = [...h.flagPatches].reverse().find((p) => p.alarmEnabled === false)
  assert.ok(rollback, '告警失败应回滚告警')
  assert.equal(Object.prototype.hasOwnProperty.call(rollback, 'monitorEnabled'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(rollback, 'trendEnabled'), false)
})

test('网络异常后刷新点位以 Host 返回为准', async () => {
  const hostPoint = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    monitorEnabled: true,
    alarmEnabled: true,
    trendEnabled: true,
  }
  const h = flagHarness({
    post: async () => {
      throw new Error('offline')
    },
    refresh: async () => ({
      ok: true,
      workspace: {
        modbus: {
          version: 3,
          points: [hostPoint],
        },
      },
    }),
  })
  await h.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.equal(h.workspaceRef.current.modbus.points[0].monitorEnabled, true)
  assert.equal(h.workspaceRef.current.modbus.points[0].alarmEnabled, true)
})

test('保存失败且刷新失败时只回滚对应字段并显示错误', async () => {
  let resolveMon
  let resolveAlm
  const post = async (_path, body) => {
    if (body.monitorEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveMon = resolve
      })
    }
    if (body.alarmEnabled !== undefined) {
      return new Promise((resolve) => {
        resolveAlm = resolve
      })
    }
    return { ok: true }
  }
  const h = flagHarness({
    post,
    refresh: async () => {
      throw new Error('refresh failed')
    },
  })
  const mon = h.actions.persistPointFlags('p1', { monitorEnabled: true })
  const alm = h.actions.persistPointFlags('p1', { alarmEnabled: true })
  await new Promise((r) => setTimeout(r, 10))
  resolveAlm({
    ok: true,
    point: { id: 'p1', monitorEnabled: true, alarmEnabled: true, trendEnabled: true },
    workspace: {
      modbus: {
        configVersion: 11,
        points: [{ id: 'p1', monitorEnabled: true, alarmEnabled: true, trendEnabled: true, alarmMin: 1, alarmMax: 9 }],
      },
    },
  })
  await alm
  resolveMon({ ok: false, error: 'monitor failed' })
  await mon
  assert.equal(h.point.monitorEnabled, false)
  assert.equal(h.point.trendEnabled, false)
  assert.equal(h.point.alarmEnabled, true)
  assert.match(h.error, /监视状态保存失败/)
})

test('CONFIG_DRIFT 刷新后携带新版本重试，监视和告警都保留', async () => {
  let calls = 0
  const hostPoint = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: '温度',
    monitorEnabled: true,
    alarmEnabled: true,
    trendEnabled: true,
    alarmMin: 1,
    alarmMax: 9,
  }
  const h = flagHarness({
    post: async (_path, body) => {
      calls += 1
      if (calls === 1) {
        assert.equal(body.monitorEnabled, true)
        assert.equal(body.expectedConfigVersion, 10)
        return { ok: false, errorCode: 'CONFIG_DRIFT', error: '点位配置已更新，请刷新后重试' }
      }
      assert.equal(body.expectedConfigVersion, 11)
      assert.equal(body.monitorEnabled, true)
      return {
        ok: true,
        point: hostPoint,
        configVersion: 12,
        workspace: { modbus: { version: 3, configVersion: 12, points: [hostPoint] } },
      }
    },
    refresh: async () => ({
      ok: true,
      workspace: {
        modbus: {
          version: 3,
          configVersion: 11,
          points: [{ ...hostPoint, monitorEnabled: false, trendEnabled: false, alarmEnabled: true }],
        },
      },
    }),
  })
  await h.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.equal(calls, 2)
  assert.equal(h.point.monitorEnabled, true)
  assert.equal(h.point.trendEnabled, true)
  assert.equal(h.point.alarmEnabled, true)
})

test('persistPointFlags passes sessionId from ctx or falls back to boundId, and details error', async () => {
  let capturedBody1 = null
  const h1 = flagHarness({
    sessionId: 'session-explicit-456',
    post: async (_path, body) => {
      capturedBody1 = body
      return { ok: true, point: { id: 'p1', monitorEnabled: true } }
    },
  })
  await h1.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.equal(capturedBody1?.sessionId, 'session-explicit-456')

  // Fallback to workspace boundId
  let capturedBody2 = null
  const h2 = flagHarness({
    session: { boundId: 'session-bound-789' },
    post: async (_path, body) => {
      capturedBody2 = body
      return { ok: true, point: { id: 'p1', monitorEnabled: true } }
    },
  })
  await h2.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.equal(capturedBody2?.sessionId, 'session-bound-789')

  // Exposing backend error detail instead of swallowing
  const h3 = flagHarness({
    post: async () => ({
      ok: false,
      errorCode: 'SESSION_REQUIRED',
      error: '该工作区已按会话隔离，配置修改必须携带 sessionId',
    }),
    refresh: async () => ({ ok: true, workspace: { modbus: baseMb() } }),
  })
  await h3.actions.persistPointFlags('p1', { monitorEnabled: true })
  assert.match(h3.error, /该工作区已按会话隔离/)
})
