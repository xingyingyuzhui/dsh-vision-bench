import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { workspaceKey } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { workspaceDir } from '../src/infrastructure/persistence/workspace-migration.mjs'

test('legacy configDrafts are ignored on load and dropped on next save', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-legacy-draft-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
    },
  })
  const dir = workspaceDir(home, workspaceKey(cwd))
  const cfgPath = join(dir, 'config.json')
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  cfg.configDrafts = [{ id: 'draft1', status: 'pending', patch: [{ op: 'add', path: '/points/-', value: {} }] }]
  const { writeJsonAtomicSync } = await import('../src/infrastructure/persistence/atomic-json.mjs')
  writeJsonAtomicSync(cfgPath, cfg)

  const loaded = loadWorkspace(home, cwd)
  assert.equal(loaded.configDrafts, undefined)

  saveWorkspace(home, cwd, { modbus: { version: 3 } })
  const saved = JSON.parse(readFileSync(cfgPath, 'utf8'))
  assert.equal(saved.configDrafts, undefined)

  const draft = await runVisionBench(home, { action: 'draft', op: 'list' }, cwd, { source: 'agent' })
  assert.equal(draft.ok, false)
  assert.equal(draft.errorCode, 'OP_REMOVED')
  await rm(home, { recursive: true, force: true })
})
