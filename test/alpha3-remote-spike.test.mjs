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

test('host inject registers Connection Fetch and keeps Web Agent command bridge', () => {
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.match(host, /inject = \['connection'\]/)
  assert.doesNotMatch(host, /inject = \['connection', 'webServer', 'tools', 'agentPresets', 'systemPrompt'\]/)
  assert.match(host, /registerVisionFetchDispatch|vision-fetch-route/)
  assert.match(host, /mountVisionWebCompat/)
  assert.doesNotMatch(host, /dsh-api-remotes/)
  assert.doesNotMatch(host, /TypertRemoteService/)
})

test('ADR-012 records Connection Fetch as the supported browser/Desktop transport', () => {
  const adr = readFileSync(join(root, 'docs/architecture/ADR-012-remote-transport.md'), 'utf8')
  assert.match(adr, /connection\.fetch\.register/)
  assert.match(adr, /\/api\/vision-bench\/dispatch/)
  assert.match(adr, /createVisionFetchPost/)
  assert.match(adr, /vision-web-compat/)
})

test('browser client does not send the retired static Vision header', () => {
  const runtime = readFileSync(join(root, 'src/ui/client/client-entry.mjs'), 'utf8')
  assert.doesNotMatch(runtime, /X-DSH-Vision-Bench/)
  assert.match(runtime, /createVisionFetchPost/)
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  const webCompat = readFileSync(join(root, 'src/interfaces/web/vision-web-compat.mjs'), 'utf8')
  assert.match(webCompat, /x-dsh-vision-capability/)
  assert.doesNotMatch(host, /const browser = origin/)
})
