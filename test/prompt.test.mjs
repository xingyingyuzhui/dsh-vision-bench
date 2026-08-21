import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { renderBenchPrompt } from '../bench-prompt.mjs'
import { recordBenchEvent, saveWorkspace } from '../bench-store.mjs'

test('renderBenchPrompt is empty until a project or operation exists', () => {
  assert.equal(renderBenchPrompt({ keil: {}, modbus: {}, log: [] }, '/tmp/ws'), '')
})

test('renderBenchPrompt names the selected project and recent ops', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-prompt-'))
  try {
    const cwd = join(home, 'board')
    const project = join(cwd, 'app.uvprojx')
    saveWorkspace(home, cwd, {
      keil: { project, target: 'Debug', artifact: 'hex' },
    })
    const again = recordBenchEvent(home, cwd, {
      action: 'build',
      ok: true,
      summary: 'build 成功，errors=0 warnings=1',
    }, { keil: { download: join(cwd, 'app.hex') } })
    const text = renderBenchPrompt(again.workspace, cwd)
    assert.match(text, /Vision 台架/)
    assert.match(text, /app\.uvprojx/)
    assert.match(text, /Target: Debug/)
    assert.match(text, /app\.hex/)
    assert.match(text, /选择工程/)
    assert.match(text, /build 成功/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
