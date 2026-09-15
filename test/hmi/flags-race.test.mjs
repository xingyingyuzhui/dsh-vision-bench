import assert from 'node:assert/strict'
import test from 'node:test'
import { act, waitFor } from '@testing-library/react'
import { baseMb, mountHmi } from '../helpers/hmi-page-fixtures.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('监视开启后立即关闭：乱序响应不得覆盖最新状态', async () => {
  const mb = baseMb()
  const deferred = []
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/points\/flags$/.test(path)) {
      return new Promise((resolve) => {
        deferred.push({ body, resolve })
      })
    }
    return { ok: true }
  }
  const tree = await mountHmi(post)
  const findMon = () =>
    Array.from(tree.container.querySelectorAll('button.dvb-switch')).find(
      (b) =>
        (b.getAttribute('aria-label') || '').includes('可视化') ||
        (b.getAttribute('title') || '').includes('可视化') ||
        (b.getAttribute('title') || '').includes('保存中'),
    )
  await act(async () => {
    findMon().click()
  })
  await waitFor(() => assert.equal(deferred.length, 1), { timeout: 4000 })
  await act(async () => {
    findMon().click()
  })
  await waitFor(() => assert.equal(deferred.length, 2), { timeout: 4000 })
  // 先完成旧请求（开启），再完成新请求（关闭）
  const first = deferred[0]
  const second = deferred[1]
  assert.equal(first.body.monitorEnabled, true)
  assert.equal(second.body.monitorEnabled, false)
  mb.points[0].monitorEnabled = true
  mb.points[0].trendEnabled = true
  mb.configVersion += 1
  await act(async () => {
    first.resolve({
      ok: true,
      point: { ...mb.points[0] },
      configVersion: mb.configVersion,
      workspace: { modbus: { ...mb, points: mb.points.map((p) => ({ ...p })) } },
    })
    await new Promise((r) => setTimeout(r, 40))
  })
  // 最新 seq 是关闭；旧响应不得把 UI 锁在开启
  mb.points[0].monitorEnabled = false
  mb.points[0].trendEnabled = false
  mb.configVersion += 1
  await act(async () => {
    second.resolve({
      ok: true,
      point: { ...mb.points[0] },
      configVersion: mb.configVersion,
      workspace: { modbus: { ...mb, points: mb.points.map((p) => ({ ...p })) } },
    })
    await new Promise((r) => setTimeout(r, 60))
  })
  await waitFor(
    () => {
      assert.equal(findMon().getAttribute('aria-pressed'), 'false')
    },
    { timeout: 6000 },
  )
  tree.unmount()
})

test('监视与告警快速连续切换互不覆盖', async () => {
  const mb = baseMb()
  const posts = []
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [],
      }
    if (/\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/points\/flags$/.test(path)) {
      posts.push(body)
      const pt = mb.points.find((p) => p.id === body.pointId)
      if (body.monitorEnabled !== undefined) {
        pt.monitorEnabled = body.monitorEnabled === true
        pt.trendEnabled = pt.monitorEnabled
      }
      if (body.alarmEnabled !== undefined) pt.alarmEnabled = body.alarmEnabled === true
      mb.configVersion += 1
      await new Promise((r) => setTimeout(r, 20))
      return {
        ok: true,
        point: { ...pt },
        configVersion: mb.configVersion,
        workspace: { modbus: { ...mb, points: mb.points.map((p) => ({ ...p })) } },
      }
    }
    return { ok: true }
  }
  const tree = await mountHmi(post)
  const switches = Array.from(tree.container.querySelectorAll('button.dvb-switch'))
  const mon = switches.find((b) => (b.getAttribute('aria-label') || '').includes('可视化'))
  const alm = switches.find((b) => (b.getAttribute('aria-label') || '').includes('告警'))
  await act(async () => {
    mon.click()
    alm.click()
    await new Promise((r) => setTimeout(r, 120))
  })
  await waitFor(
    () => {
      assert.ok(posts.some((p) => p.monitorEnabled === true))
      assert.ok(posts.some((p) => p.alarmEnabled === true))
      assert.equal(mon.getAttribute('aria-pressed'), 'true')
      assert.equal(alm.getAttribute('aria-pressed'), 'true')
    },
    { timeout: 6000 },
  )
  tree.unmount()
})
