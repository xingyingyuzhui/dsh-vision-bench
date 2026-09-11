// @ts-check
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { appendDebugEvent, shouldPersistDebugEvent, withDebugEventPersistence } from '../../src/application/debug/debug-event-sink.mjs'
import { createDebugEventRing } from '../../src/domain/debug/debug-event.mjs'

const failingFactory = async () => ({
  async start() {
    throw new Error('目标未响应: OpenOCD 连接被拒绝')
  },
  async stop() {},
  subscribe: () => () => {},
})

test('A1: 启动失败后保留可查询的墓碑，且不污染活跃会话', async () => {
  const runtime = createDebugRuntime({ backendFactory: failingFactory })

  await assert.rejects(() =>
    runtime.start({ debugSessionId: 'ds_fail', ownerSessionId: 'sess_a', workspaceCwd: '/ws' }),
  )

  // 活跃集保持干净
  assert.equal(runtime.findOwnedSession({ ownerSessionId: 'sess_a', workspaceCwd: '/ws' }), null)
  assert.equal(runtime.findSession((s) => s.debugSessionId === 'ds_fail'), null)
  assert.equal(runtime.listSessions().length, 0)

  // 但失败原因可查
  const tomb = runtime.getFailedSession({ debugSessionId: 'ds_fail' })
  assert.ok(tomb, '应能查到失败会话')
  assert.equal(tomb.state, 'failed')
  assert.match(tomb.failure.message, /OpenOCD 连接被拒绝/)
  assert.ok(tomb.failure.errorCode)
  assert.ok(tomb.failure.at > 0)

  // 归属隔离：别人的 sessionId 查不到
  assert.equal(runtime.getFailedSession({ debugSessionId: 'ds_fail', ownerSessionId: 'sess_other' }), null)

  await runtime.shutdown()
})

test('A1: listFailedSessions 按工作区过滤', async () => {
  const runtime = createDebugRuntime({ backendFactory: failingFactory })
  await assert.rejects(() => runtime.start({ debugSessionId: 'ds_a', ownerSessionId: 's', workspaceCwd: '/ws-a' }))
  await assert.rejects(() => runtime.start({ debugSessionId: 'ds_b', ownerSessionId: 's', workspaceCwd: '/ws-b' }))

  assert.equal(runtime.listFailedSessions({ workspaceCwd: '/ws-a' }).length, 1)
  assert.equal(runtime.listFailedSessions().length, 2)
  await runtime.shutdown()
})

test('A1: shutdown 清空墓碑', async () => {
  const runtime = createDebugRuntime({ backendFactory: failingFactory })
  await assert.rejects(() => runtime.start({ debugSessionId: 'ds_x', ownerSessionId: 's', workspaceCwd: '/ws' }))
  assert.ok(runtime.getFailedSession({ debugSessionId: 'ds_x' }))
  await runtime.shutdown()
  assert.equal(runtime.getFailedSession({ debugSessionId: 'ds_x' }), null)
})

test('A1: shouldPersistDebugEvent 只保留生命周期与错误事件', () => {
  assert.equal(shouldPersistDebugEvent({ type: 'debug.session.starting' }), true)
  assert.equal(shouldPersistDebugEvent({ type: 'debug.session.ready' }), true)
  assert.equal(shouldPersistDebugEvent({ type: 'debug.session.failed' }), true)
  assert.equal(shouldPersistDebugEvent({ type: 'debug.paused' }), false)
  assert.equal(shouldPersistDebugEvent({ type: 'debug.step.complete' }), false)
  // 带 error payload 的任意事件都保留
  assert.equal(shouldPersistDebugEvent({ type: 'debug.console', payload: { error: 'boom' } }), true)
  assert.equal(shouldPersistDebugEvent(null), false)
})

test('A1: 事件写入 NDJSON 日志', () => {
  const home = mkdtempSync(join(tmpdir(), 'dvb-journal-'))
  try {
    const ok = appendDebugEvent(home, 'ds_j', { type: 'debug.session.ready', payload: {}, debugSessionId: 'ds_j' })
    assert.equal(ok, true)
    const file = join(home, 'vision-bench', 'debug-journal', 'ds_j.ndjson')
    assert.ok(existsSync(file))
    const line = JSON.parse(readFileSync(file, 'utf8').trim())
    assert.equal(line.type, 'debug.session.ready')

    // 不保留的事件不落盘
    assert.equal(appendDebugEvent(home, 'ds_j', { type: 'debug.paused' }), false)
    // 缺 home 时不抛错、返回 false
    assert.equal(appendDebugEvent('', 'ds_j', { type: 'debug.session.ready' }), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('A1: withDebugEventPersistence 透传完整读取接口', () => {
  const home = mkdtempSync(join(tmpdir(), 'dvb-j2-'))
  try {
    const wrapped = withDebugEventPersistence(createDebugEventRing(10), { home })
    for (const name of ['push', 'getEventsSince', 'getEventsAfter', 'getCurrentCursor', 'waitForEvents', 'waitForEventsAfter']) {
      assert.equal(typeof wrapped[name], 'function', `应透传 ${name}`)
    }
    wrapped.push({ debugSessionId: 'ds_p', type: 'debug.session.starting', payload: {} })
    const since = wrapped.getEventsSince(0)
    assert.equal(since.events.length, 1)
    assert.ok(existsSync(join(home, 'vision-bench', 'debug-journal', 'ds_p.ndjson')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('A1: 未提供 home 时包装退化为原环，不写盘', () => {
  const ring = createDebugEventRing(10)
  const wrapped = withDebugEventPersistence(ring, {})
  assert.equal(wrapped, ring)
})

test('B3: backend 经事件流报告失败但正常返回时，start 显式失败', async () => {
  /** @type {((event: any) => void) | null} */
  let emit = null
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      subscribe(listener) {
        emit = listener
        return () => {}
      },
      async start() {
        // 模拟 GDB 进程在启动过程中意外退出：reducer 会把状态推到 failed，
        // 但 start() 本身正常返回。旧的守卫会让这次失败静默溜过。
        emit?.({ type: 'backend.exited', unexpected: true, code: 1, signal: null })
      },
      async stop() {},
    }),
  })

  await assert.rejects(
    () => runtime.start({ debugSessionId: 'ds_ghost', ownerSessionId: 's', workspaceCwd: '/ws' }),
    (err) => {
      assert.equal(err.code, 'DEBUG_BACKEND_UNAVAILABLE')
      assert.match(err.message, /立即失败|意外退出/)
      return true
    },
  )
  assert.equal(runtime.findOwnedSession({ ownerSessionId: 's', workspaceCwd: '/ws' }), null)
  await runtime.shutdown()
})

test('B3: backend 正常启动且状态为 ready 时不受影响', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      subscribe: () => () => {},
      async start() {},
      async stop() {},
    }),
  })
  const view = await runtime.start({ debugSessionId: 'ds_good', ownerSessionId: 's', workspaceCwd: '/ws' })
  assert.equal(view.state, 'ready')
  await runtime.shutdown()
})
