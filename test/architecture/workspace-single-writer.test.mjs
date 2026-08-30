import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const allowed = new Set([
  'src/infrastructure/persistence/workspace-repository.mjs',
  'src/infrastructure/persistence/workspace-migration.mjs',
  'src/infrastructure/persistence/atomic-json.mjs',
])

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'coverage' || name === 'test' || name === 'client.js') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (/\.(mjs|js)$/.test(name) && !name.endsWith('.test.mjs')) acc.push(p)
  }
  return acc
}

test('workspace file writes stay inside persistence modules', async () => {
  const files = walk(root)
  const hits = []
  for (const file of files) {
    const rel = file.slice(root.length + 1).replaceAll('\\', '/')
    if (allowed.has(rel)) continue
    if (rel.startsWith('scripts/')) continue
    const src = readFileSync(file, 'utf8')
    if (/saveV4Workspace\s*\(/.test(src)) hits.push(`${rel}: saveV4Workspace`)
    if (/writeJsonAtomicSync\s*\([^)]*workspace/.test(src)) hits.push(`${rel}: writeJsonAtomicSync workspace`)
  }
  assert.deepEqual(hits, [])
})
