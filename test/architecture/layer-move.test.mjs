// @ts-check
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const moved = [
  'modbus-migration.mjs',
  'modbus-migrate-steps.mjs',
  'modbus-compat-accessors.mjs',
  'target-resolver-service.mjs',
  'trend-model.mjs',
]

test('pure modbus modules live in domain and are not forwarded from application', () => {
  for (const name of moved) {
    assert.equal(existsSync(join(root, 'src/domain/modbus', name)), true, name)
    assert.equal(existsSync(join(root, 'src/application/modbus', name)), false, name)
  }
  assert.equal(existsSync(join(root, 'src/application/modbus/config-scope-service.mjs')), true)
})

test('dependency rules forbid infrastructure and ui from importing application', () => {
  const src = readFileSync(join(root, 'dependency-cruiser.config.mjs'), 'utf8')
  assert.match(src, /name: 'infrastructure-no-application'/)
  assert.match(src, /name: 'ui-no-application'/)
  assert.match(src, /severity: 'error'/)
  assert.match(src, /from: \{ path: '\^src\/interfaces\/agent\/' \}/)
  assert.match(src, /src\/infrastructure\/\(store\|modbus\)/)
})
