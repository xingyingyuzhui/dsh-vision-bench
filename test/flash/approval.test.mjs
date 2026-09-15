import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { openocdDownload } from '../../bench-flash.mjs'
import { journalView, loadWorkspace } from '../../bench-store.mjs'
import { createFlashApprovalStore } from '../../src/application/flash/flash-approval-service.mjs'
import { FLASH_ERROR_CODES } from '../../src/domain/flash/errors.mjs'
import {
  approve,
  downloadTasks,
  flashTest,
  seedFirmware,
  start,
} from '../helpers/flash-fixtures.mjs'

flashTest('unapproved flash only returns needsConfirm and opens no download task', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-confirm-')
    const first = await start(home, cwd, { sessionId: 's1', source: 'agent' })
    assert.equal(first.needsConfirm, true)
    assert.equal(first.ok, false)
    assert.ok(first.request.requestId)
    assert.ok(first.request.sha256)
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download').length, 0)
})
flashTest('裸 confirm:true 无法开始烧录', async (t) => {
  const { home, cwd, fw } = await seedFirmware(t, 'dvb-flash-naked-')
    const first = await start(home, cwd)
    const bypass = await openocdDownload(home, cwd, {
      confirm: true,
      path: fw,
      sha256: first.request.sha256,
      size: first.request.size,
      interface: 'jlink',
      target: 'stm32h7x',
    })
    assert.equal(bypass.ok, false)
    assert.equal(bypass.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_REQUIRED)
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download').length, 0)
})
flashTest('批准请求只能使用一次，且忽略批准体里的 path/interface/target', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-once-')
    const first = await start(home, cwd)
    let seen
    const ran = await approve(
      home,
      cwd,
      first,
      { path: '/tmp/evil.hex', interface: 'jlink', target: 'nrf52', sha256: 'dead', size: 1 },
      {
        runOpenOcdFlash: async (spec) => {
          seen = spec
          return { ok: true, summary: '烧录完成', details: { output: 'verify ok' }, exitCode: 0 }
        },
      },
    )
    assert.equal(ran.ok, true)
    assert.equal(seen.interfaceName, 'stlink')
    assert.equal(seen.target, 'stm32f4x')
    assert.match(seen.firmware, /flash-staging/)
    const replay = await approve(home, cwd, first, {}, { runOpenOcdFlash: async () => ({ ok: true }) })
    assert.equal(replay.ok, false)
    assert.equal(replay.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND)
})
flashTest('批准后原固件被覆盖则拒绝烧录且不启动 OpenOCD', async (t) => {
  const { home, cwd, fw } = await seedFirmware(t, 'dvb-flash-toctou-')
    const first = await start(home, cwd, { source: 'agent', sessionId: 's1' })
    await writeFile(fw, ':020000040800F2\n:00000001FF\n')
    let called = 0
    const second = await approve(
      home,
      cwd,
      first,
      { sessionId: 's1' },
      {
        runOpenOcdFlash: async () => {
          called += 1
          return { ok: true, summary: '烧录完成' }
        },
      },
    )
    assert.equal(second.ok, false)
    assert.equal(second.errorCode, FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_MISMATCH)
    assert.equal(called, 0)
})
flashTest('拒绝请求不会创建下载任务，也不会执行 OpenOCD', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-reject-')
    const first = await start(home, cwd)
    let called = 0
    const rejected = await openocdDownload(
      home,
      cwd,
      { requestId: first.request.requestId, approved: false },
      {
        runOpenOcdFlash: async () => {
          called += 1
          return { ok: true }
        },
      },
    )
    assert.equal(rejected.cancelled, true)
    assert.equal(called, 0)
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download').length, 0)
})
flashTest('过期请求失败', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-exp-')
    let nowMs = 1000
    const approvals = createFlashApprovalStore({ ttlMs: 10, now: () => nowMs })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x' }, { approvals })
    nowMs = 2000
    const ran = await openocdDownload(home, cwd, { requestId: first.request.requestId, approved: true }, { approvals })
    assert.equal(ran.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_EXPIRED)
})
flashTest('Session B 不能批准或拒绝 Session A 的刷写，且不会提前消费', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-scope-')
    const first = await start(home, cwd, { source: 'agent', sessionId: 'sess-a' })
    let called = 0
    const runner = {
      runOpenOcdFlash: async () => {
        called += 1
        return { ok: true, summary: '烧录完成', details: { output: 'verify ok' } }
      },
    }
    const otherApprove = await approve(home, cwd, first, { source: 'user', sessionId: 'sess-b' }, runner)
    assert.equal(otherApprove.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH)
    const otherReject = await openocdDownload(
      home,
      cwd,
      { requestId: first.request.requestId, approved: false, sessionId: 'sess-b' },
      runner,
    )
    assert.equal(otherReject.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH)
    assert.equal(called, 0)
    const ran = await approve(home, cwd, first, { source: 'user', sessionId: 'sess-a' }, runner)
    assert.equal(ran.ok, true)
    assert.equal(ran.source, 'agent')
    assert.equal(ran.sessionId, 'sess-a')
    assert.equal(ran.approvedBySessionId, 'sess-a')
    const task = downloadTasks(home, cwd)[0]
    assert.equal(task.source, 'agent')
    assert.equal(task.sessionId, 'sess-a')
})
