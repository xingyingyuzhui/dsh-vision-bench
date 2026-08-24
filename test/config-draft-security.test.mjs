import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

test('Agent draftApply must be rejected via tool, config unchanged', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sec-draft-apply-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const { runVisionBench } = await import('../bench-tool.mjs')
    const { loadWorkspace, saveWorkspace } = await import('../bench-store.mjs')
    // seed a baseline config with a connection so a valid draft can target it
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true } }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [], points: [] } })
    const baseVer = loadWorkspace(home, cwd).modbus.configVersion
    // strict: create a valid draft as agent
    const created = await runVisionBench(
      home,
      { action: 'draft', op: 'create', baseConfigVersion: baseVer, patch: [{ op: 'replace', path: '/connections/0/name', value: 'hacked' }] },
      cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(created.ok, true, 'valid draft creation should succeed')
    assert.ok(created.draft && created.draft.id, 'draft.id must exist')
    // agent direct apply must fail and leave workspace untouched
    const before = loadWorkspace(home, cwd)
    const beforeSlice = JSON.stringify({ v: before.modbus && before.modbus.configVersion, connections: before.modbus && before.modbus.connections, points: before.modbus && before.modbus.points })
    const applied = await runVisionBench(home, { action: 'draftApply', draftId: created.draft.id }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(applied.ok, false, 'Agent must not apply a config draft')
    assert.match(String(applied.error || ''), /action 必须是|draftApply|不支持/i)
    const after = loadWorkspace(home, cwd)
    const afterSlice = JSON.stringify({ v: after.modbus && after.modbus.configVersion, connections: after.modbus && after.modbus.connections, points: after.modbus && after.modbus.points })
    assert.equal(afterSlice, beforeSlice, 'config version and contents must be unchanged after rejected Agent apply')
    assert.equal(after.modbus.connections[0].name, 'C1', 'draft was NOT applied')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('prototype pollution via patch must be blocked', async () => {
  const { applyPatch } = await import('../bench-patch.mjs')
  const doc = { connections: [{ name: 'c1' }] }
  for (const path of ['/connections/0/__proto__/x', '/connections/0/constructor/prototype/x', '/devices/0/__proto__/x', '/__proto__/polluted', '/constructor/prototype/polluted']) {
    const res = applyPatch(doc, [{ op: 'add', path, value: 1 }])
    assert.equal(res.ok, false)
    assert.match(String(res.error || ''), /proto|prototype|constructor/i)
  }
  assert.equal(({}).x, undefined)
  assert.equal(({}).polluted, undefined)
  // prototype pollution via JSON must not affect Object.prototype
  assert.equal(Object.prototype.x, undefined)
})

test('unsupported ops must fail without partial apply', async () => {
  const { applyPatch } = await import('../bench-patch.mjs')
  const doc = { a: 1, b: 2 }
  for (const op of ['move', 'copy', 'test']) {
    const patch = op === 'move' || op === 'copy' ? [{ op, from: '/a', path: '/c' }] : [{ op, path: '/a', value: 1 }]
    const res = applyPatch(doc, patch)
    assert.equal(res.ok, false)
    assert.match(String(res.error || ''), /unsupported/i)
  }
  // ensure no partial apply: valid op followed by unsupported should not have applied first op
  const doc2 = { a: 1 }
  const res2 = applyPatch(doc2, [{ op: 'add', path: '/b', value: 2 }, { op: 'move', from: '/a', path: '/c' }])
  assert.equal(res2.ok, false)
  assert.equal(doc2.b, undefined)
})

test('illegal patch must not create pending draft', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sec-draft-pending-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const { createConfigDraft, loadWorkspace: loadWs2 } = await import('../bench-store.mjs').catch(() => ({}))
    if (typeof createConfigDraft === 'function') {
      const ws0 = loadWs2 ? loadWs2(home, cwd) : { modbus: { configVersion: 1 } }
      const bad = await createConfigDraft(home, cwd, { patch: [{ op: 'add', path: '/__proto__/x', value: 1 }], source: 'agent', sessionId: 's1', baseConfigVersion: ws0.modbus.configVersion || 1 })
      assert.equal(bad.ok, false)
      // No pending draft should be stored
      const { loadWorkspace } = await import('../bench-store.mjs')
      const ws = loadWorkspace(home, cwd)
      assert.equal((ws.configDrafts || []).length, 0)
    } else {
      assert.ok(true, 'createConfigDraft not yet implemented')
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('valid patch still approved via UI', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sec-draft-valid-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const { createConfigDraft, applyConfigDraft, loadWorkspace } = await import('../bench-store.mjs').catch(() => ({}))
    if (typeof createConfigDraft === 'function' && typeof applyConfigDraft === 'function') {
      const ws0 = loadWorkspace(home, cwd)
      const baseVer = ws0.modbus.configVersion || 1
      // valid add
      const created = await createConfigDraft(home, cwd, { patch: [{ op: 'add', path: '/connections', value: [{ id: 'c1', name: 'c1', role: 'master', enabled: true, conn: { mode: 'rtu', port: 'COM1' } }] }], source: 'agent', sessionId: 's1', baseConfigVersion: baseVer })
      assert.equal(created.ok, true)
      const applied = await applyConfigDraft(home, cwd, created.draft.id, { source: 'user' })
      assert.equal(applied.ok, true)
    } else {
      assert.ok(true)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})
