import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { detectPresetTrack, dshPackageRootFromExecPath, dshSearchPaths } from '../../src/infrastructure/harness/dsh-contract.mjs'

/**
 * @param {string[]} packages `@deepseek-ai/*` package names to materialize
 * @returns {Promise<string>} resolution root (its `node_modules` holds the packages)
 */
async function fixtureRoot(packages) {
  const root = await mkdtemp(join(tmpdir(), 'dvb-track-'))
  for (const name of packages) {
    const dir = join(root, 'node_modules', '@deepseek-ai', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, main: 'index.js' }))
    await writeFile(join(dir, 'index.js'), '')
  }
  return root
}

test('detectPresetTrack distinguishes declarative, legacy, and unknown installs', async () => {
  const declarative = await fixtureRoot(['dsh-agent-preset-registry'])
  const legacy = await fixtureRoot(['dsh-agent-presets'])
  const both = await fixtureRoot(['dsh-agent-preset-registry', 'dsh-agent-presets'])
  const unknown = await mkdtemp(join(tmpdir(), 'dvb-track-'))
  try {
    assert.equal(detectPresetTrack([declarative]), 'declarative')
    assert.equal(detectPresetTrack([legacy]), 'legacy')
    assert.equal(detectPresetTrack([both]), 'legacy')
    assert.equal(detectPresetTrack([unknown]), 'unknown')
  } finally {
    await rm(declarative, { recursive: true, force: true })
    await rm(legacy, { recursive: true, force: true })
    await rm(both, { recursive: true, force: true })
    await rm(unknown, { recursive: true, force: true })
  }
})

test('dsh search paths follow the running Node prefix, including Windows', async () => {
  const source = await readFile(new URL('../../src/infrastructure/harness/dsh-contract.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('24.18.0'), false)
  assert.ok(dshSearchPaths().includes(dshPackageRootFromExecPath()))
  assert.equal(
    dshPackageRootFromExecPath('/opt/homebrew/Cellar/node@24/24.18.0/bin/node', 'linux'),
    '/opt/homebrew/Cellar/node@24/24.18.0/lib/node_modules/@deepseek-ai/dsh',
  )
  assert.equal(
    dshPackageRootFromExecPath('C:\\Program Files\\nodejs\\node.exe', 'win32'),
    'C:\\Program Files\\nodejs\\node_modules\\@deepseek-ai\\dsh',
  )
})
