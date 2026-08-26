import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const localImportsOf = (file) => {
  const abs = join(root, file)
  const text = readFileSync(abs, 'utf8')
  const out = []
  const re = /from '(\.[^']+\.mjs)'/g
  let match
  while ((match = re.exec(text))) {
    const resolved = normalize(join(dirname(abs), match[1]))
    const rel = relative(root, resolved).replaceAll('\\', '/')
    if (!rel.startsWith('..')) out.push(rel)
  }
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
