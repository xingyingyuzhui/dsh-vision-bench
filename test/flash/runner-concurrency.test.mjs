import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { keilBuild } from '../../bench-keil.mjs'
import { openTask, saveBindings, saveWorkspace } from '../../bench-store.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'
import {
  approve,
  clearFlashApprovals,
  flashTest,
  seedFirmware,
  start,
} from '../helpers/flash-fixtures.mjs'

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
