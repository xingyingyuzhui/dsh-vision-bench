import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeFacadeAst, checkFacadePurity } from '../../scripts/check-facade-purity.mjs'

test('pure re-export facade produces no impurity findings', () => {
  const src = `export { foo } from './src/application/foo.mjs'\n`
  assert.deepEqual(analyzeFacadeAst('bench-pure.mjs', src), [])
})

test('short function and import are impure', () => {
  const src = `
import { listWorkspaceDir } from './src/infrastructure/files/project-fs.mjs'
export const listDir = (cwd, path) => listWorkspaceDir(cwd, path)
`
  const findings = analyzeFacadeAst('bench-actions.mjs', src)
  assert.ok(findings.some((f) => f.kind === 'import'))
  assert.ok(findings.some((f) => f.kind === 'variable' && f.name === 'listDir'))
})

test('re-exporting another bench facade is impure', () => {
  const src = `export { listDir } from './bench-listdir.mjs'\n`
  const findings = analyzeFacadeAst('bench-modbus-forward.mjs', src)
  assert.ok(findings.some((f) => f.kind === 'reexport-bench-facade'))
})

test('current facades pass with the compat allowlist', () => {
  const result = checkFacadePurity()
  assert.equal(result.ok, true, result.violations.join('\n'))
})
