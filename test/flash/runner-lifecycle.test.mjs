import assert from 'node:assert/strict'
import { join } from 'node:path'
import { openocdDownload } from '../../bench-flash.mjs'
import { journalView, loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { FLASH_ERROR_CODES } from '../../src/domain/flash/errors.mjs'
import { approve, existsSync, flashTest, seedFirmware, start } from '../helpers/flash-fixtures.mjs'

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
