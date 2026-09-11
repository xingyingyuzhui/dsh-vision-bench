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

test('client inject uses connection for authenticated RPC, not Typert remote', () => {
  const entry = readFileSync(join(root, 'src/ui/client/client-entry.mjs'), 'utf8')
  assert.match(entry, /inject = \['slots', 'locale', 'connection'\]/)
  assert.doesNotMatch(entry, /['"]remote['"]/)
})

test('host inject registers Connection RPC and keeps only the Agent command bridge', () => {
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.match(host, /inject = \['connection', 'webServer'\]/)
  assert.doesNotMatch(host, /inject = \['connection', 'webServer', 'tools', 'agentPresets', 'systemPrompt'\]/)
  assert.match(host, /connection\.rpc\.handle/)
  assert.doesNotMatch(host, /dsh-api-remotes/)
  assert.doesNotMatch(host, /TypertRemoteService/)
})

test('ADR-012 records Connection RPC as the supported alpha.3 browser transport', () => {
  const adr = readFileSync(join(root, 'docs/architecture/ADR-012-remote-transport.md'), 'utf8')
  assert.match(adr, /connection\.rpc\.handle/)
  assert.match(adr, /connection\.rpc\.call/)
  assert.match(adr, /Do not fake authentication/)
})

test('browser client does not send the retired static Vision header', () => {
  const runtime = readFileSync(join(root, 'bench-runtime.mjs'), 'utf8')
  assert.doesNotMatch(runtime, /X-DSH-Vision-Bench/)
  assert.match(runtime, /createVisionRpcPost/)
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.match(host, /x-dsh-vision-capability/)
  assert.doesNotMatch(host, /const browser = origin/)
})
