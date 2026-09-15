import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beginRequest, shouldApplyRequest } from '../../src/ui/common/latest-request-gate.mjs'
import { matchesIdentity, projectIdentityKey, tagMappedState } from '../../src/ui/debug/project/project-shared.mjs'
import { MAP_DETAILS } from '../helpers/project-workspace-fixtures.mjs'

test('projectIdentityKey combines session, cwd, project and target', () => {
  const key = projectIdentityKey('s1', '/ws', { project: 'p.uvprojx', target: 'Debug' })
  assert.equal(key, ['s1', '/ws', 'p.uvprojx', 'Debug'].join('\0'))
  assert.notEqual(
    projectIdentityKey('s1', '/ws', { project: 'p.uvprojx', target: 'Debug' }),
    projectIdentityKey('s2', '/ws', { project: 'p.uvprojx', target: 'Debug' }),
  )
})

test('matchesIdentity rejects stale tagged state', () => {
  const key = projectIdentityKey('s1', '/ws', { project: 'p', target: 'Debug' })
  const mapped = tagMappedState(MAP_DETAILS, key)
  assert.equal(matchesIdentity(mapped, key), true)
  assert.equal(matchesIdentity(mapped, projectIdentityKey('s2', '/ws', { project: 'p', target: 'Debug' })), false)
})

test('shouldApplyRequest requires latest id, identity and mount', () => {
  const ref = { current: 2 }
  const mounted = { current: true }
  const id = 'a\0/ws\0p\0Debug'
  assert.equal(shouldApplyRequest(ref, 2, id, id, mounted), true)
  assert.equal(shouldApplyRequest(ref, 1, id, id, mounted), false)
  assert.equal(shouldApplyRequest(ref, 2, id, 'other', mounted), false)
  mounted.current = false
  assert.equal(shouldApplyRequest(ref, 2, id, id, mounted), false)
})

test('beginRequest increments monotonically', () => {
  const ref = { current: 0 }
  assert.equal(beginRequest(ref), 1)
  assert.equal(beginRequest(ref), 2)
})
