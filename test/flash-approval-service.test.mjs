import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openocdDownload } from '../bench-flash.mjs'
import { journalView, loadWorkspace, saveBindings, saveWorkspace } from '../bench-store.mjs'
import {
  MAX_FLASH_APPROVALS,
  clearFlashApprovals,
  createFlashApprovalStore,
  defaultFlashApprovals,
} from '../src/application/flash/flash-approval-service.mjs'
import { FLASH_ERROR_CODES } from '../src/domain/flash/errors.mjs'

const spec = (extra = {}) => ({
  cwd: '/ws',
  path: '/ws/app.hex',
  name: 'app.hex',
  size: 12,
  sha256: 'abc',
  interfaceName: 'stlink',
  target: 'stm32f4x',
  ...extra,
})

test('Session A 创建后仅 Session A 可以批准', () => {
  const store = createFlashApprovalStore()
  const rec = store.create(spec({ sessionId: 'sess-a', source: 'agent' }))
  const denied = store.consume(rec.requestId, { cwd: '/ws', sessionId: 'sess-b' })
  assert.equal(denied.ok, false)
  assert.equal(denied.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH)
  assert.equal(store.size(), 1)
  const ok = store.consume(rec.requestId, { cwd: '/ws', sessionId: 'sess-a' })
  assert.equal(ok.ok, true)
  assert.equal(ok.record.source, 'agent')
  assert.equal(ok.record.sessionId, 'sess-a')
  assert.equal(store.size(), 0)
})

test('Session B 拒绝不会消费 Session A 的审批', () => {
  const store = createFlashApprovalStore()
  const rec = store.create(spec({ sessionId: 'sess-a' }))
  const denied = store.consume(rec.requestId, { cwd: '/ws', sessionId: 'sess-b' })
  assert.equal(denied.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH)
  const ok = store.consume(rec.requestId, { cwd: '/ws', sessionId: 'sess-a' })
  assert.equal(ok.ok, true)
})

test('不同 cwd 不能消费审批', () => {
  const store = createFlashApprovalStore()
  const rec = store.create(spec({ cwd: '/ws-a', sessionId: 'sess-a' }))
  const denied = store.consume(rec.requestId, { cwd: '/ws-b', sessionId: 'sess-a' })
  assert.equal(denied.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH)
  assert.equal(store.size(), 1)
})

test('双方都没有 sessionId 时允许匹配，只有一方没有则拒绝', () => {
  const store = createFlashApprovalStore()
  const bothEmpty = store.create(spec())
  assert.equal(store.consume(bothEmpty.requestId, { cwd: '/ws' }).ok, true)

  const onlyRecord = store.create(spec({ sessionId: 'sess-a' }))
  assert.equal(
    store.consume(onlyRecord.requestId, { cwd: '/ws' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH,
  )

  const onlyScope = store.create(spec())
  assert.equal(
    store.consume(onlyScope.requestId, { cwd: '/ws', sessionId: 'sess-a' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH,
  )
})

test('缺少 requestId 时返回 NOT_FOUND', () => {
  const store = createFlashApprovalStore()
  const missing = store.consume('', { cwd: '/ws' })
  assert.equal(missing.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND)
  assert.equal(store.consume(null, { cwd: '/ws' }).errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND)
})

test('已消费、已过期、作用域不匹配三类错误保持区分', () => {
  let t = 1000
  const store = createFlashApprovalStore({ ttlMs: 10, now: () => t })
  const live = store.create(spec({ sessionId: 'a' }))
  const expired = store.create(spec({ sessionId: 'a' }))
  assert.equal(
    store.consume(live.requestId, { cwd: '/ws', sessionId: 'b' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH,
  )
  assert.equal(store.consume(live.requestId, { cwd: '/ws', sessionId: 'a' }).ok, true)
  assert.equal(
    store.consume(live.requestId, { cwd: '/ws', sessionId: 'a' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND,
  )
  t = 2000
  assert.equal(
    store.consume(expired.requestId, { cwd: '/ws', sessionId: 'a' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_EXPIRED,
  )
  assert.equal(
    store.consume(expired.requestId, { cwd: '/ws', sessionId: 'a' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND,
  )
})

test('创建和消费都会主动清除过期记录', () => {
  let t = 1000
  const store = createFlashApprovalStore({ ttlMs: 10, now: () => t })
  store.create(spec({ sessionId: 'old' }))
  assert.equal(store.size(), 1)
  t = 1020
  store.create(spec({ sessionId: 'fresh' }))
  assert.equal(store.size(), 1)

  t = 2000
  const a = store.create(spec({ sessionId: 'a' }))
  t = 2005
  const b = store.create(spec({ sessionId: 'b' }))
  t = 2011
  assert.equal(store.consume(b.requestId, { cwd: '/ws', sessionId: 'b' }).ok, true)
  assert.equal(
    store.consume(a.requestId, { cwd: '/ws', sessionId: 'a' }).errorCode,
    FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND,
  )
  assert.equal(store.size(), 0)
})

test('容量不超过上限，超限时删除最旧记录', () => {
  const store = createFlashApprovalStore({ max: 3 })
  const a = store.create(spec({ path: '/ws/a.hex' }))
  const b = store.create(spec({ path: '/ws/b.hex' }))
  store.create(spec({ path: '/ws/c.hex' }))
  store.create(spec({ path: '/ws/d.hex' }))
  assert.equal(store.size(), 3)
  assert.equal(store.consume(a.requestId, { cwd: '/ws' }).errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND)
  assert.equal(store.consume(b.requestId, { cwd: '/ws' }).ok, true)
})

test('默认仓库容量上限为 256，clearFlashApprovals 清空', () => {
  clearFlashApprovals()
  assert.equal(MAX_FLASH_APPROVALS, 256)
  for (let i = 0; i < MAX_FLASH_APPROVALS + 8; i++) {
    defaultFlashApprovals.create(spec({ path: '/ws/' + i + '.hex' }))
  }
  assert.ok(defaultFlashApprovals.size() <= MAX_FLASH_APPROVALS)
  clearFlashApprovals()
  assert.equal(defaultFlashApprovals.size(), 0)
})

test('成功批准后任务保留原始 source 和 sessionId', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-approval-origin-'))
  try {
    const cwd = join(home, 'board')
    await mkdir(cwd)
    saveBindings(home, { python: '', uv4: '', openocd: '/opt/openocd' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, {
      interface: 'stlink',
      target: 'stm32f4x',
      source: 'agent',
      sessionId: 'sess-a',
    })
    const ran = await openocdDownload(
      home,
      cwd,
      { requestId: first.request.requestId, approved: true, source: 'user', sessionId: 'sess-a' },
      { runOpenOcdFlash: async () => ({ ok: true, summary: '烧录完成', details: { output: 'verify ok' } }) },
    )
    assert.equal(ran.ok, true)
    assert.equal(ran.source, 'agent')
    assert.equal(ran.sessionId, 'sess-a')
    assert.equal(ran.approvedBySessionId, 'sess-a')
    const task = journalView(loadWorkspace(home, cwd)).tasks.find((item) => item.type === 'download')
    assert.equal(task.source, 'agent')
    assert.equal(task.sessionId, 'sess-a')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
