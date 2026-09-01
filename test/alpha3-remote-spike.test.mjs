import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('Vision does not ship Typert Remote compiler output', () => {
  assert.equal(existsSync(join(root, 'typert.host.js')), false)
  assert.equal(existsSync(join(root, 'lib/typert.host.js')), false)
  assert.equal(
    (pkg.files || []).some((item) => String(item).includes('typert')),
    false,
  )
})

test('Vision does not depend on dsh-typert-protocol or api-remotes', () => {
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies }
  assert.equal('@deepseek-ai/dsh-typert-protocol' in deps, false)
  assert.equal('@deepseek-ai/dsh-api-remotes' in deps, false)
})

test('client inject does not claim a Remote namespace that Host cannot provide', () => {
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-locale'])
  const entry = readFileSync(join(root, 'src/ui/client/client-entry.mjs'), 'utf8')
  assert.match(entry, /inject = \['slots', 'locale'\]/)
  assert.doesNotMatch(entry, /['"]remote['"]/)
})

test('host inject has webServer, not a first-party remotes service', () => {
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.match(host, /inject = \['webServer', 'tools', 'agentPresets', 'systemPrompt'\]/)
  assert.doesNotMatch(host, /dsh-api-remotes/)
  assert.doesNotMatch(host, /TypertRemoteService/)
})

test('ADR-012 records that official Remote packaging is blocked for thin JS', () => {
  const adr = readFileSync(join(root, 'docs/architecture/ADR-012-remote-transport.md'), 'utf8')
  assert.match(adr, /TypertRemoteService/)
  assert.match(adr, /typert.host.js/)
  assert.match(adr, /Do not fake authentication with a static/)
})
