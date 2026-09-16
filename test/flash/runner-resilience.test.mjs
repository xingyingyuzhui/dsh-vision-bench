import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { keilBuild } from '../../bench-keil.mjs'
import {
  loadWorkspace,
  saveBindings,
  saveWorkspace,
  finishTask as storeFinishTask,
} from '../../bench-store.mjs'
import { FLASH_ERROR_CODES } from '../../src/domain/flash/errors.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'
import {
  approve,
  downloadTasks,
  flashTest,
  seedFirmware,
  stagingNames,
  start,
} from '../helpers/flash-fixtures.mjs'

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
