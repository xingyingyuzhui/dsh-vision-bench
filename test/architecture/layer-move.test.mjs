// @ts-check
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import cruiserConfig from '../../dependency-cruiser.config.mjs'

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
  const rules = /** @type {{ name: string, severity: string, from: { path: string }, to: { path: string } }[]} */ (
    cruiserConfig.forbidden
  )
  const names = new Set(rules.map((rule) => rule.name))
  assert.equal(names.has('infrastructure-no-application'), true)
  assert.equal(names.has('ui-no-application'), true)
  const agent = rules.find((rule) => rule.name === 'agent-tool-no-store-or-io')
  assert.ok(agent)
  assert.equal(agent.severity, 'error')
  assert.match(agent.from.path, /^\^src\/interfaces\/agent\//)
  assert.match(agent.to.path, /src\/infrastructure\/\(store\|modbus\)/)
  for (const name of ['infrastructure-no-application', 'ui-no-application']) {
    assert.equal(rules.find((rule) => rule.name === name)?.severity, 'error')
  }
})
