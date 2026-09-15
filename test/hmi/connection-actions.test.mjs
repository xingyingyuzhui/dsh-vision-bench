import assert from 'node:assert/strict'
import test from 'node:test'
import { liveHarness } from '../helpers/hmi-page-fixtures.mjs'

test('断开连接抛出异常时显示错误并清除 busy，不伪装已断开', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') throw new Error('close exploded')
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /close exploded|失败/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.connectionStates[0].status, 'connected')
})

test('断开连接返回 ok:false 时显示错误并刷新真实状态', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') return { ok: false, error: 'port busy' }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /port busy/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.connectionStates[0].status, 'connected')
})

test('关闭连接后 /state 刷新失败仍有错误提示并清除 busy', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/close') return { ok: true }
      if (path === '/dsh-vision-bench/state') throw new Error('state down')
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.unlinkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(h.error)
  assert.equal(h.linkBusy, '')
})

test('采集启动抛出异常时显示错误且不伪装已开始采集', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/polling/start') throw new Error('poll exploded')
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.toggleCollection())
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /poll exploded|失败/)
  assert.equal(h.linkBusy, '')
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
})

test('采集启动返回 ok:false 时显示错误', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/polling/start') return { ok: false, error: 'already running' }
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.toggleCollection())
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /already running/)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
})

test('修改采集间隔失败时保留原间隔并显示错误', async () => {
  const posts = []
  const h = liveHarness({
    post: async (path, body) => {
      posts.push({ path, body })
      if (path === '/dsh-vision-bench/polling/start') return { ok: false, error: 'interval denied' }
      if (path === '/dsh-vision-bench/state') {
        return {
          ok: true,
          workspace: { modbus: { pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } } } },
        }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.setPollingInterval(2000))
  await new Promise((r) => setTimeout(r, 20))
  assert.match(h.error, /interval denied/)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.intervalMs, 1000)
  assert.equal(h.workspace.modbus.pollingByConnection.c1.enabled, false)
  assert.ok(posts.some((item) => item.path === '/dsh-vision-bench/polling/start'))
})

test('连接失败返回结构化 error 对象时被安全转为文本，不抛出 React 渲染异常', async () => {
  const h = liveHarness({
    post: async (path) => {
      if (path === '/dsh-vision-bench/connection/open') {
        return { ok: false, error: { code: 'PORT_NOT_FOUND', message: '串口不存在' } }
      }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'error', error: '串口不存在' }] }
      }
      return { ok: true }
    },
  })
  await Promise.resolve(h.actions.linkConnection('c1'))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(typeof h.error, 'string')
  assert.equal(h.error, '串口不存在')
  assert.equal(h.linkBusy, '')
})

test('linkConnection starts polling with intervalMs, and unlinkConnection stops polling', async () => {
  const posts = []
  const h = liveHarness({
    post: async (path, body) => {
      posts.push({ path, body })
      if (path === '/dsh-vision-bench/connection/open') return { ok: true }
      if (path === '/dsh-vision-bench/polling/start') return { ok: true }
      if (path === '/dsh-vision-bench/polling/stop') return { ok: true }
      if (path === '/dsh-vision-bench/connection/close') return { ok: true }
      if (path === '/dsh-vision-bench/state') {
        return { ok: true, connectionStates: [{ connectionId: 'c1', status: 'connected' }] }
      }
      return { ok: true }
    },
  })

  // 1. linkConnection
  await h.actions.linkConnection('c1')
  const openCall = posts.find((p) => p.path === '/dsh-vision-bench/connection/open')
  const startCall = posts.find((p) => p.path === '/dsh-vision-bench/polling/start')
  assert.ok(openCall, 'open connection called')
  assert.ok(startCall, 'polling start called')
  assert.equal(startCall.body.connectionId, 'c1')
  assert.equal(startCall.body.intervalMs, 1000)

  // 2. unlinkConnection
  posts.length = 0
  await h.actions.unlinkConnection('c1')
  const stopCall = posts.find((p) => p.path === '/dsh-vision-bench/polling/stop')
  const closeCall = posts.find((p) => p.path === '/dsh-vision-bench/connection/close')
  assert.ok(stopCall, 'polling stop called')
  assert.ok(closeCall, 'close connection called')
  assert.equal(stopCall.body.connectionId, 'c1')
  assert.equal(closeCall.body.connectionId, 'c1')
})
