import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { beforeEach } from 'node:test'
import { createAgentPresetAttacher } from '../../src/infrastructure/host/vision-preset-attach.mjs'
import {
  PRESET_ID,
  activateVisionPresetDeclaration,
  getDeclarationState,
  resetDeclarationState,
  setDeclarationState,
  userPresetDir,
} from '../../src/infrastructure/harness/preset-declaration.mjs'

const SLOT = Symbol.for('dsh-vision-bench.preset-declaration')

const OWNED_MARKER = JSON.stringify({
  owner: 'dsh-vision-bench',
  presetSchemaVersion: 3,
  basePresetId: 'standard',
  pluginRowId: 'vision-bench-tools',
})

function declarationSlot() {
  const host = /** @type {any} */ (globalThis)
  if (!host[SLOT] || typeof host[SLOT].epoch !== 'number') {
    host[SLOT] = { epoch: 0, settled: Promise.resolve() }
  }
  return host[SLOT]
}

beforeEach(() => {
  const slot = declarationSlot()
  slot.epoch = 0
  slot.settled = Promise.resolve()
  resetDeclarationState()
})

/**
 * @param {() => boolean} ready
 * @param {number} [timeoutMs]
 */
async function waitFor(ready, timeoutMs = 1000) {
  const start = Date.now()
  while (!ready()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for preset attach')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function homeWithLegacyPreset() {
  const home = await mkdtemp(join(tmpdir(), 'dvb-hmr-'))
  const dir = userPresetDir(home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), '- id: persona\n  name: persona\n')
  await writeFile(join(dir, 'preset.yml'), 'name: Vision模式\n')
  await writeFile(join(dir, '.dsh-vision-bench'), OWNED_MARKER)
  return home
}

/**
 * Registry whose first register occupies the id and waits, matching DSH 0.1.7:
 * `register` resolves only after the mount, and a taken id throws.
 */
function mountingRegistry() {
  let calls = 0
  /** @type {Set<string>} */
  const ids = new Set()
  /** @type {() => void} */
  let release = () => {}
  const gate = new Promise((resolve) => {
    release = resolve
  })
  /** @type {() => void} */
  let markStarted = () => {}
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  return {
    calls: () => calls,
    started,
    release,
    /** @param {any} definition */
    async register(definition) {
      calls += 1
      if (ids.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
      ids.add(definition.id)
      if (calls === 1) {
        markStarted()
        await gate
      }
      let removed = false
      return async () => {
        if (removed) return
        removed = true
        ids.delete(definition.id)
      }
    },
    async list() {
      return [...ids].map((id) => ({ id, name: 'Vision模式' }))
    },
  }
}

/**
 * @param {any} registry
 * @param {string} home
 * @param {{ recheckDelayMs?: number }} [options]
 */
function startFiber(registry, home, options = {}) {
  /** @type {(() => void) | null} */
  let stop = null
  const presetCtx = {
    agentPresets: registry,
    /** @param {() => (() => void) | void} run */
    effect(run) {
      stop = run() || null
    },
  }
  const attach = createAgentPresetAttacher(
    { effect() {} },
    { getHome: () => home, recheckDelayMs: options.recheckDelayMs ?? 60_000 },
  )
  attach(presetCtx)
  return () => {
    if (stop) stop()
  }
}

test('a legacy registry does not enter the declarative registration path', () => {
  let ran = false
  const attach = createAgentPresetAttacher(
    {
      effect() {
        ran = true
      },
    },
    { getHome: () => '/unused' },
  )
  attach({ agentPresets: { register() {}, copy() {} } })
  assert.equal(ran, false)
  assert.equal(getDeclarationState().mode, 'legacy')
})

test('a new fiber waits for the previous unregister, then registers once', async () => {
  const home = await homeWithLegacyPreset()
  const registry = mountingRegistry()
  const stopA = startFiber(registry, home)
  try {
    await registry.started
    stopA()
    const stopB = startFiber(registry, home)
    registry.release()
    await waitFor(() => getDeclarationState().phase === 'registered' && registry.calls() >= 2)
    assert.equal(registry.calls(), 2)
    const rows = await registry.list()
    assert.deepEqual(rows.map((row) => row.id), [PRESET_ID])
    const state = getDeclarationState()
    assert.equal(state.phase, 'registered')
    assert.equal(state.via, 'agentPresets.register')
    assert.equal(state.error, '')
    const entries = await readdir(join(home, '.agent-presets'))
    assert.equal(entries.filter((name) => name.startsWith('.vision-bench.backup.')).length, 1)
    assert.ok(!entries.includes(PRESET_ID))
    stopB()
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a stale fiber write does not replace the active declaration', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-hmr-'))
  try {
    declarationSlot().epoch = 2
    setDeclarationState(
      {
        mode: 'declarative',
        phase: 'registered',
        via: 'agentPresets.register',
        at: 'new-fiber',
        error: '',
      },
      2,
    )
    const registry = {
      async register() {
        return async () => {}
      },
      async list() {
        return [{ id: PRESET_ID, name: 'Vision模式' }]
      },
    }
    await activateVisionPresetDeclaration(registry, home, { epoch: 1, duplicateRetries: 0 })
    const state = getDeclarationState()
    assert.equal(state.phase, 'registered')
    assert.equal(state.at, 'new-fiber')
    assert.equal(state.error, '')
    assert.equal(state.via, 'agentPresets.register')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('an external declaration does not migrate the legacy directory', async () => {
  const home = await homeWithLegacyPreset()
  try {
    const registry = {
      async register() {
        throw new Error('Duplicate agent preset: vision-bench')
      },
      async list() {
        return [{ id: PRESET_ID, name: 'Vision模式' }]
      },
    }
    const activation = await activateVisionPresetDeclaration(registry, home, { duplicateRetries: 0 })
    assert.equal(activation.via, 'external-declaration')
    assert.equal(activation.migration.migrated, false)
    assert.ok((await readdir(userPresetDir(home))).includes('agent.cordis.yml'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a vanished external row is registered again', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-hmr-'))
  let calls = 0
  /** @type {any[]} */
  const rows = []
  const registry = {
    calls: () => calls,
    /** @param {any} definition */
    async register(definition) {
      calls += 1
      if (calls < 5) throw new Error('Duplicate agent preset: vision-bench')
      rows.push(definition)
      return async () => {
        rows.length = 0
      }
    },
    async list() {
      return rows.map((definition) => ({ id: definition.id, name: definition.name }))
    },
  }
  const stop = startFiber(registry, home, { recheckDelayMs: 20 })
  try {
    await waitFor(
      () => getDeclarationState().phase === 'registered' && getDeclarationState().via === 'agentPresets.register' && registry.calls() >= 5,
      1500,
    )
    const rowsNow = await registry.list()
    assert.deepEqual(rowsNow.map((row) => row.id), [PRESET_ID])
    assert.equal(getDeclarationState().error, '')
  } finally {
    stop()
    await rm(home, { recursive: true, force: true })
  }
})

test('a recheck that still cannot see the row marks the declaration failed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-hmr-'))
  const registry = {
    async register() {
      throw new Error('Duplicate agent preset: vision-bench')
    },
    async list() {
      return []
    },
  }
  const stop = startFiber(registry, home, { recheckDelayMs: 20 })
  try {
    await waitFor(() => getDeclarationState().phase === 'failed', 1500)
    assert.match(getDeclarationState().error, /vision-bench/)
  } finally {
    stop()
    await rm(home, { recursive: true, force: true })
  }
})
