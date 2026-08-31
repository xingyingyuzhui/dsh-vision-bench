import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openocdDownload } from '../bench-flash.mjs'
import { journalView, loadWorkspace, saveBindings, saveWorkspace } from '../bench-store.mjs'

test('unapproved flash only returns needsConfirm and opens no download task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-confirm-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: '/bin/echo' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, {
      interface: 'stlink',
      target: 'stm32f4x',
      source: 'agent',
      sessionId: 's1',
    })
    assert.equal(first.needsConfirm, true)
    assert.equal(first.ok, false)
    assert.ok(first.request.sha256)
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download').length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('openocdDownload refuses when firmware changed after confirmation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-toctou-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: '/bin/echo' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, {
      interface: 'stlink',
      target: 'stm32f4x',
      source: 'agent',
      sessionId: 's1',
    })
    assert.equal(first.needsConfirm, true)
    await writeFile(fw, ':020000040800F2\n:00000001FF\n')
    const second = await openocdDownload(home, cwd, {
      interface: 'stlink',
      target: 'stm32f4x',
      source: 'agent',
      sessionId: 's1',
      confirm: true,
      sha256: first.request.sha256,
      size: first.request.size,
    })
    assert.equal(second.ok, false)
    assert.match(String(second.error || ''), /固件已变化/)
    assert.equal(journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download').length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Python 为空时确认后走 Node runner，不调用 Python', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-node-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: '/opt/openocd' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x', source: 'user' })
    assert.equal(first.needsConfirm, true)
    let called = 0
    const ran = await openocdDownload(
      home,
      cwd,
      {
        interface: 'stlink',
        target: 'stm32f4x',
        source: 'user',
        confirm: true,
        sha256: first.request.sha256,
        size: first.request.size,
      },
      {
        runOpenOcdFlash: async (spec) => {
          called += 1
          assert.equal(spec.openocd, '/opt/openocd')
          assert.match(spec.firmware, /app\.hex$/)
          return { ok: true, summary: '烧录完成', details: { output: 'verify ok' }, exitCode: 0 }
        },
      },
    )
    assert.equal(called, 1)
    assert.equal(ran.ok, true)
    assert.equal(ran.summary, '烧录完成')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('OpenOCD 启动失败 / 非零退出 / 取消都会结束任务且不依赖 Python', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-fail-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: '/opt/openocd' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x' })
    const confirm = {
      interface: 'stlink',
      target: 'stm32f4x',
      confirm: true,
      sha256: first.request.sha256,
      size: first.request.size,
    }
    const boom = await openocdDownload(home, cwd, confirm, {
      runOpenOcdFlash: async () => ({
        ok: false,
        error: '无法启动 OpenOCD',
        summary: '无法启动 OpenOCD',
        details: { output: '' },
      }),
    })
    assert.equal(boom.ok, false)
    assert.match(boom.error, /无法启动/)
    const nonzero = await openocdDownload(home, cwd, confirm, {
      runOpenOcdFlash: async () => ({
        ok: false,
        exitCode: 1,
        error: 'probe fail',
        summary: '烧录失败',
        details: { output: 'probe fail' },
      }),
    })
    assert.equal(nonzero.ok, false)
    const cancelled = await openocdDownload(home, cwd, confirm, {
      runOpenOcdFlash: async () => ({
        ok: false,
        cancelled: true,
        error: '已取消',
        summary: '烧录已取消',
        details: { output: '' },
      }),
    })
    assert.equal(cancelled.cancelled, true)
    assert.equal(cancelled.ok, false)
    const timed = await openocdDownload(home, cwd, confirm, {
      runOpenOcdFlash: async () => ({
        ok: false,
        timedOut: true,
        error: '烧录超时（150s）',
        summary: '烧录超时',
        details: { output: '' },
      }),
    })
    assert.equal(timed.ok, false)
    assert.equal(timed.timedOut, true)
    assert.match(String(timed.summary || timed.error || ''), /超时/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('非法 interface/target 拒绝，不回退未校验旧值', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-iface-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: '/opt/openocd' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw, flash: { interface: '../passwd', target: 'stm32f4x; -c exit' } } })
    const fallback = await openocdDownload(home, cwd, { source: 'user' })
    assert.equal(fallback.needsConfirm, true)
    assert.equal(fallback.request.interface, 'cmsis-dap')
    assert.equal(fallback.request.target, 'stm32f1x')
    const bad = await openocdDownload(home, cwd, { interface: '../passwd', target: 'stm32f4x' })
    assert.equal(bad.ok, false)
    assert.equal(bad.needsConfirm, undefined)
    assert.match(String(bad.error || ''), /白名单/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('echo/空输出退出码 0 不能误报烧录成功，任务不是烧录完成', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-fake-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: '/bin/echo' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x' })
    const confirm = {
      interface: 'stlink',
      target: 'stm32f4x',
      confirm: true,
      sha256: first.request.sha256,
      size: first.request.size,
    }
    const echo = await openocdDownload(home, cwd, confirm, {
      runExecFile: async () => ({ exitCode: 0, stdout: 'hello', stderr: '', timedOut: false, cancelled: false }),
    })
    assert.equal(echo.ok, false)
    assert.notEqual(echo.summary, '烧录完成')
    const empty = await openocdDownload(home, cwd, confirm, {
      runExecFile: async (_bin, args) => {
        if (args && args.includes('--version')) {
          return {
            exitCode: 0,
            stdout: '',
            stderr: 'Open On-Chip Debugger 0.12.0\n',
            timedOut: false,
            cancelled: false,
          }
        }
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, cancelled: false }
      },
    })
    assert.equal(empty.ok, false)
    assert.equal(empty.errorCode, 'FLASH_RESULT_UNVERIFIED')
    const tasks = journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download')
    assert.ok(tasks.length >= 1)
    assert.ok(tasks.every((item) => item.summary !== '烧录完成'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
