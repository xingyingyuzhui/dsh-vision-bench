import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openocdDownload } from '../../bench-flash.mjs'
import { keilBuild } from '../../bench-keil.mjs'
import {
  journalView,
  loadWorkspace,
  openTask,
  saveBindings,
  saveWorkspace,
  finishTask as storeFinishTask,
} from '../../bench-store.mjs'
import { FLASH_ERROR_CODES } from '../../src/domain/flash/errors.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'
import {
  approve,
  clearFlashApprovals,
  downloadTasks,
  existsSync,
  flashTest,
  seedFirmware,
  stagingNames,
  start,
} from '../helpers/flash-fixtures.mjs'

flashTest('Python 为空时确认后走 Node runner，OpenOCD 使用快照路径', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-node-')
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
})
flashTest('成功、失败、取消、超时后快照均被清理', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-clean-')
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
})
flashTest('OpenOCD 启动失败 / 非零退出 / 取消都会结束任务且不依赖 Python', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-fail-')
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
})
flashTest('探测阶段取消与烧录阶段取消都记 cancelled', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-probe-cancel-')
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
})
flashTest('非法已保存 profile 失败关闭，不回退默认芯片', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-iface-')
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
})
flashTest('并发 download 只能成功开启一个任务', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-cc-')
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
})
flashTest('download 运行中拒绝 build', async (t) => {
  const home = await createTempDir(t, 'dvb-flash-vs-build-')
  const cwd = join(home, 'board')
  await mkdir(cwd)
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
})
flashTest('echo/空输出退出码 0 不能误报烧录成功', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-fake-')
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
  clearFlashApprovals()
})
flashTest('Runner 抛异常 / 返回 undefined 都会 FLASH_FAILED 并结束任务', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-throw-')
    let finishes = 0
    const first = await start(home, cwd)
    const boom = await approve(
      home,
      cwd,
      first,
      {},
      {
        finishTask: async (...args) => {
          finishes += 1
          return storeFinishTask(...args)
        },
        runOpenOcdFlash: async () => {
          throw new Error('openocd crashed at /opt/openocd')
        },
      },
    )
    assert.equal(boom.ok, false)
    assert.equal(boom.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
    assert.doesNotMatch(String(boom.error), /\/opt\/openocd/)
    assert.equal(finishes, 1)
    assert.ok(downloadTasks(home, cwd).every((item) => item.status !== 'running'))
    assert.deepEqual(stagingNames(home), [])
    const second = await start(home, cwd)
    const empty = await approve(home, cwd, second, {}, { runOpenOcdFlash: async () => undefined })
    assert.equal(empty.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
    assert.ok(downloadTasks(home, cwd).every((item) => item.status !== 'running'))
    const third = await start(home, cwd)
    assert.equal(third.needsConfirm, true)
    const weird = await approve(home, cwd, third, {}, { runOpenOcdFlash: async () => ({ foo: 1 }) })
    assert.equal(weird.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
    assert.deepEqual(stagingNames(home), [])
})
flashTest('快照创建或输出解析抛异常后任务进入 error，并可立即再刷写', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-parse-')
    const first = await start(home, cwd)
    const snap = await approve(
      home,
      cwd,
      first,
      {},
      {
        createFirmwareSnapshot: () => {
          throw new Error('snapshot boom')
        },
        runOpenOcdFlash: async () => ({ ok: true, summary: '烧录完成' }),
      },
    )
    assert.equal(snap.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
    assert.ok(downloadTasks(home, cwd).every((item) => item.status === 'error'))
    assert.deepEqual(stagingNames(home), [])
    const second = await start(home, cwd)
    const parsed = await approve(
      home,
      cwd,
      second,
      {},
      {
        runOpenOcdFlash: async () => ({
          ok: true,
          summary: '烧录完成',
          details: {
            get output() {
              throw new Error('parse boom')
            },
          },
        }),
      },
    )
    assert.equal(parsed.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
    assert.ok(downloadTasks(home, cwd).every((item) => item.status !== 'running'))
    assert.deepEqual(stagingNames(home), [])
    const again = await start(home, cwd)
    assert.equal(again.needsConfirm, true)
    assert.notEqual(again.errorCode, 'TASK_CONFLICT')
})
flashTest('快照清理失败不覆盖刷写结果，也不会二次 finishTask', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-cleanup-')
    let finishes = 0
    const first = await start(home, cwd)
    const ran = await approve(
      home,
      cwd,
      first,
      {},
      {
        finishTask: async (...args) => {
          finishes += 1
          return storeFinishTask(...args)
        },
        runOpenOcdFlash: async () => ({ ok: true, summary: '烧录完成', details: { output: 'verify ok' } }),
        removeFirmwareSnapshot: () => {
          throw new Error('cleanup boom')
        },
      },
    )
    assert.equal(ran.ok, true)
    assert.equal(finishes, 1)
    assert.ok(Array.isArray(ran.warnings) && ran.warnings.length > 0)
    assert.equal(downloadTasks(home, cwd)[0].status, 'ok')
})
flashTest('finishTask 抛错时仍返回 FLASH_FAILED 且不会留下 running', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-finish-throw-')
    const first = await start(home, cwd)
    const ran = await approve(
      home,
      cwd,
      first,
      {},
      {
        finishTask: async () => {
          throw new Error('finish boom')
        },
        runOpenOcdFlash: async () => {
          throw new Error('runner boom')
        },
      },
    )
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
})
flashTest('快照返回空对象或清理失败都会结构化收尾', async (t) => {
  const { home, cwd } = await seedFirmware(t, 'dvb-flash-empty-snap-')
    const first = await start(home, cwd)
    const emptySnap = await approve(home, cwd, first, {}, { createFirmwareSnapshot: () => null })
    assert.equal(emptySnap.errorCode, FLASH_ERROR_CODES.FLASH_FAILED)
    assert.ok(downloadTasks(home, cwd).every((item) => item.status !== 'running'))
    const second = await start(home, cwd)
    const cleaned = await approve(
      home,
      cwd,
      second,
      {},
      {
        runOpenOcdFlash: async () => ({ ok: true, summary: '烧录完成', details: { output: 'verify ok' } }),
        removeFirmwareSnapshot: () => ({
          ok: false,
          errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_CLEANUP_FAILED,
          error: '快照清理失败',
        }),
      },
    )
    assert.equal(cleaned.ok, true)
    assert.ok(cleaned.warnings && cleaned.warnings.length > 0)
})
flashTest('Keil 执行器抛异常后不会留下运行中任务，也不会挡住刷写', async (t) => {
  const home = await createTempDir(t, 'dvb-keil-throw-')
  const cwd = join(home, 'board')
  await mkdir(cwd)
    saveBindings(home, { python: process.execPath, uv4: process.execPath, openocd: '/opt/openocd' })
    const project = join(cwd, 'app.uvprojx')
    const fw = join(cwd, 'app.hex')
    await writeFile(project, '<Project/>')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { project, target: 'Debug', download: fw } })
    const boom = await keilBuild(
      home,
      cwd,
      { source: 'user' },
      {
        runPythonScript: async () => {
          throw new Error('uv4 crashed')
        },
      },
    )
    assert.equal(boom.ok, false)
    assert.match(boom.error, /uv4 crashed/)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.tasks[0].status, 'error')
    const first = await start(home, cwd)
    assert.equal(first.needsConfirm, true)
    assert.notEqual(first.errorCode, 'TASK_CONFLICT')
    const second = await keilBuild(
      home,
      cwd,
      { source: 'user' },
      { runPythonScript: async () => ({ ok: false, error: 'compile fail', result: { summary: 'fail', details: {} } }) },
    )
    assert.notEqual(second.errorCode, 'TASK_CONFLICT')
    assert.equal(second.ok, false)
})
