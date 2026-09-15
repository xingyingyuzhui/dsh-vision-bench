import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { clearFlashApprovals, openocdDownload } from '../../bench-flash.mjs'
import { journalView, loadWorkspace, saveBindings, saveWorkspace, storeDir } from '../../bench-store.mjs'
import { createTempDir } from './workspace-factory.mjs'

let flashGate = Promise.resolve()

/** @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
export async function withFlashLock(fn) {
  let release = () => {}
  const wait = new Promise((resolve) => { release = resolve })
  const prev = flashGate
  flashGate = wait
  await prev
  try { return await fn() } finally { release() }
}

/** Register a flash test that holds the process-wide approval lock for its duration. */
export function flashTest(name, fn) {
  test(name, (t) => withFlashLock(() => fn(t)))
}

export async function seedFirmware(t, prefix = 'dvb-flash-') {
  const home = await createTempDir(t, prefix)
  clearFlashApprovals()
  const cwd = join(home, 'board')
  await mkdir(cwd)
  saveBindings(home, { python: '', uv4: '', openocd: '/opt/openocd' })
  const fw = join(cwd, 'app.hex')
  await writeFile(fw, ':020000040800F2\n')
  saveWorkspace(home, cwd, { keil: { download: fw } })
  return { home, cwd, fw }
}

export function stagingNames(home) {
  const root = join(storeDir(home), 'flash-staging')
  return existsSync(root) ? readdirSync(root) : []
}

export function downloadTasks(home, cwd) {
  return journalView(loadWorkspace(home, cwd)).tasks.filter((item) => item.type === 'download')
}

export const start = (home, cwd, extra = {}) =>
  openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x', source: 'user', ...extra })

export const approve = (home, cwd, first, extra = {}, opts) =>
  openocdDownload(home, cwd, { requestId: first.request.requestId, approved: true, ...extra }, opts)

export { existsSync, clearFlashApprovals }
