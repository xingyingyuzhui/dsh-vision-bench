import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const localImportsOf = (file) => {
  const text = readFileSync(join(root, file), 'utf8')
  const out = []
  const re = /from '(\.\/[^']+\.mjs)'/g
  let match
  while ((match = re.exec(text))) out.push(match[1].slice(2))
  return out
}

test('every shipped module is listed in package.json files', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const files = new Set(pkg.files)
  const seen = new Set(['host.js'])
  const queue = ['host.js']
  while (queue.length) {
    const file = queue.pop()
    for (const dep of localImportsOf(file)) {
      if (seen.has(dep)) continue
      seen.add(dep)
      queue.push(dep)
    }
  }
  for (const file of seen) {
    assert.ok(files.has(file), file + ' is imported but missing from package.json files[]')
  }
})
