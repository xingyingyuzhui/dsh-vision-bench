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
    saveBindings(home, { python: process.execPath, uv4: '', openocd: '/bin/echo' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x', source: 'agent', sessionId: 's1' })
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
    saveBindings(home, { python: process.execPath, uv4: '', openocd: '/bin/echo' })
    const fw = join(cwd, 'app.hex')
    await writeFile(fw, ':020000040800F2\n')
    saveWorkspace(home, cwd, { keil: { download: fw } })
    const first = await openocdDownload(home, cwd, { interface: 'stlink', target: 'stm32f4x', source: 'agent', sessionId: 's1' })
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
