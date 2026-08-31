import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { _internal as flashInternal, openocdDownload } from '../bench-flash.mjs'
import { keilBuild } from '../bench-keil.mjs'
import { journalView, loadWorkspace, openTask, saveBindings, saveWorkspace } from '../bench-store.mjs'
import { createFlashApprovalStore } from '../src/application/flash/flash-approval-service.mjs'
import { FLASH_ERROR_CODES } from '../src/domain/flash/errors.mjs'

const seedFirmware = async (home) => {
  const cwd = join(home, 'board')
  await mkdir(cwd)
  saveBindings(home, { python: '', uv4: '', openocd: '/opt/openocd' })
  const fw = join(cwd, 'app.hex')
  await writeFile(fw, ':020000040800F2\n')
  saveWorkspace(home, cwd, { keil: { download: fw } })
  return { cwd, fw }
}

const start = (home, cwd, extra = {}) =>
  openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x', source: 'user', ...extra })

const approve = (home, cwd, first, extra = {}, opts) =>
  openocdDownload(home, cwd, { requestId: first.request.requestId, approved: true, ...extra }, opts)

test('unapproved flash only returns needsConfirm and opens no download task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-confirm-'))
  try {
    const { cwd } = await seedFirmware(home)
    const first = await start(home, cwd, { sessionId: 's1', source: 'agent' })
    assert.equal(first.needsConfirm, true)
    assert.equal(first.ok, false)
    assert.ok(first.request.requestId)
    assert.ok(first.request.sha256)
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download').length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('裸 confirm:true 无法开始烧录', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-naked-'))
  try {
    const { cwd, fw } = await seedFirmware(home)
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
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('批准请求只能使用一次，且忽略批准体里的 path/interface/target', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-once-'))
  try {
    const { cwd } = await seedFirmware(home)
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
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('批准后原固件被覆盖则拒绝烧录且不启动 OpenOCD', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-toctou-'))
  try {
    const { cwd, fw } = await seedFirmware(home)
    const first = await start(home, cwd, { source: 'agent', sessionId: 's1' })
    await writeFile(fw, ':020000040800F2\n:00000001FF\n')
    let called = 0
    const second = await approve(
      home,
      cwd,
      first,
      {},
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
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Python 为空时确认后走 Node runner，OpenOCD 使用快照路径', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-node-'))
  try {
    const { cwd } = await seedFirmware(home)
    const first = await start(home, cwd)
    let called = 0
    const ran = await approve(
      home,
      cwd,
      first,
      {},
      {
        runOpenOcdFlash: async (spec) => {
          called += 1
          assert.equal(spec.openocd, '/opt/openocd')
          assert.match(spec.firmware, /flash-staging/)
          assert.equal(existsSync(spec.firmware), true)
          return { ok: true, summary: '烧录完成', details: { output: 'verify ok' }, exitCode: 0 }
        },
      },
    )
    assert.equal(called, 1)
    assert.equal(ran.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('成功、失败、取消、超时后快照均被清理', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-clean-'))
  try {
    const { cwd } = await seedFirmware(home)
    const outcomes = [
      { ok: true, summary: '烧录完成' },
      { ok: false, error: '无法启动 OpenOCD', summary: '无法启动 OpenOCD', details: { output: '' } },
      { ok: false, cancelled: true, error: '已取消', summary: '烧录已取消' },
      { ok: false, timedOut: true, error: '烧录超时（150s）', summary: '烧录超时' },
    ]
    for (const outcome of outcomes) {
      const first = await start(home, cwd)
      let snapPath = ''
      await approve(
        home,
        cwd,
        first,
        {},
        {
          runOpenOcdFlash: async (spec) => {
            snapPath = spec.firmware
            assert.equal(existsSync(snapPath), true)
            return outcome
          },
        },
      )
      assert.ok(snapPath)
      assert.equal(existsSync(snapPath), false, String(outcome.summary || outcome.error))
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('拒绝请求不会创建下载任务，也不会执行 OpenOCD', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-reject-'))
  try {
    const { cwd } = await seedFirmware(home)
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
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('过期请求失败', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-exp-'))
  try {
    const { cwd } = await seedFirmware(home)
    let t = 1000
    const approvals = createFlashApprovalStore({ ttlMs: 10, now: () => t })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x' }, { approvals })
    t = 2000
    const ran = await openocdDownload(home, cwd, { requestId: first.request.requestId, approved: true }, { approvals })
    assert.equal(ran.errorCode, FLASH_ERROR_CODES.FLASH_APPROVAL_EXPIRED)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('OpenOCD 启动失败 / 非零退出 / 取消都会结束任务且不依赖 Python', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-fail-'))
  try {
    const { cwd } = await seedFirmware(home)
    const first = await start(home, cwd)
    const boom = await approve(
      home,
      cwd,
      first,
      {},
      {
        runOpenOcdFlash: async () => ({
          ok: false,
          error: '无法启动 OpenOCD',
          summary: '无法启动 OpenOCD',
          details: { output: '' },
        }),
      },
    )
    assert.equal(boom.ok, false)
    assert.match(boom.error, /无法启动/)
    const second = await start(home, cwd)
    const cancelled = await approve(
      home,
      cwd,
      second,
      {},
      {
        runOpenOcdFlash: async () => ({
          ok: false,
          cancelled: true,
          error: '已取消',
          summary: '烧录已取消',
          details: { output: '' },
        }),
      },
    )
    assert.equal(cancelled.cancelled, true)
    const tasks = journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download')
    assert.ok(tasks.some((item) => item.status === 'cancelled'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('探测阶段取消与烧录阶段取消都记 cancelled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-probe-cancel-'))
  try {
    const { cwd } = await seedFirmware(home)
    const first = await start(home, cwd)
    const probeCancel = await approve(
      home,
      cwd,
      first,
      {},
      {
        runOpenOcdFlash: async () => ({
          ok: false,
          cancelled: true,
          errorCode: FLASH_ERROR_CODES.FLASH_CANCELLED,
          error: '已取消',
          summary: '烧录已取消',
        }),
      },
    )
    assert.equal(probeCancel.cancelled, true)
    const tasks = journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download')
    assert.ok(tasks.every((item) => item.status === 'cancelled' || item.status === 'error'))
    assert.ok(tasks.some((item) => item.status === 'cancelled'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('非法已保存 profile 失败关闭，不回退默认芯片', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-iface-'))
  try {
    const { cwd } = await seedFirmware(home)
    saveWorkspace(home, cwd, {
      keil: {
        download: join(cwd, 'app.hex'),
        flash: { interface: '../passwd', target: 'stm32f4x; -c exit' },
      },
    })
    const bad = await openocdDownload(home, cwd, { source: 'user' })
    assert.equal(bad.ok, false)
    assert.ok(
      bad.errorCode === FLASH_ERROR_CODES.FLASH_INTERFACE_INVALID ||
        bad.errorCode === FLASH_ERROR_CODES.FLASH_TARGET_INVALID,
    )
    const reqBad = await openocdDownload(home, cwd, { interface: '../passwd', target: 'stm32f4x' })
    assert.equal(reqBad.errorCode, FLASH_ERROR_CODES.FLASH_INTERFACE_INVALID)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('并发 download 只能成功开启一个任务', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-cc-'))
  try {
    const { cwd } = await seedFirmware(home)
    const a = await start(home, cwd)
    const b = await start(home, cwd)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const p1 = approve(
      home,
      cwd,
      a,
      {},
      {
        runOpenOcdFlash: async () => {
          await gate
          return { ok: true, summary: '烧录完成', details: { output: '' } }
        },
      },
    )
    await new Promise((r) => setTimeout(r, 20))
    const p2 = approve(
      home,
      cwd,
      b,
      {},
      {
        runOpenOcdFlash: async () => ({ ok: true, summary: '烧录完成' }),
      },
    )
    const second = await p2
    assert.equal(second.ok, false)
    assert.equal(second.errorCode, 'TASK_CONFLICT')
    release()
    const first = await p1
    assert.equal(first.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('download 运行中拒绝 build', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-vs-build-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: process.execPath, uv4: process.execPath, openocd: '/opt/openocd' })
    const fw = join(cwd, 'app.hex')
    const project = join(cwd, 'app.uvprojx')
    await writeFile(fw, ':020000040800F2\n')
    await writeFile(project, '<Project/>')
    saveWorkspace(home, cwd, { keil: { download: fw, project, target: 'Debug' } })
    await openTask(home, cwd, { type: 'download', source: 'user', summary: '烧录中' })
    const blocked = await keilBuild(home, cwd, { source: 'user' })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.errorCode, 'TASK_CONFLICT')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('echo/空输出退出码 0 不能误报烧录成功', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-fake-'))
  try {
    const { cwd } = await seedFirmware(home)
    saveBindings(home, { python: '', uv4: '', openocd: '/bin/echo' })
    const first = await start(home, cwd)
    const echo = await approve(
      home,
      cwd,
      first,
      {},
      {
        runExecFile: async () => ({ exitCode: 0, stdout: 'hello', stderr: '', timedOut: false, cancelled: false }),
      },
    )
    assert.equal(echo.ok, false)
    assert.notEqual(echo.summary, '烧录完成')
  } finally {
    flashInternal.approvals.clear()
    await rm(home, { recursive: true, force: true })
  }
})
