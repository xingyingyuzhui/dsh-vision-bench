import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { sessionCwd, useSessionCwd } from '../src/ui/common/session-scope.mjs'
import {
  ALPHA3_DSH_VERSION,
  ALPHA3_PAGE_PROP_KEYS,
  alpha3PageProps,
  alpha3Workspace,
} from './fixtures/harness-alpha3-props.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'coverage' || name === 'client.js') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (/\.(mjs|js)$/.test(name)) acc.push(full)
  }
  return acc
}

function productionSources() {
  return [
    ...walk(join(root, 'src')),
    ...readdirSync(root)
      .filter((name) => name.startsWith('bench-') && name.endsWith('.mjs'))
      .map((name) => join(root, name)),
    join(root, 'host.js'),
  ]
}

test('alpha.3 fixture documents DSH 0.1.2-alpha.3 and public page keys', () => {
  assert.equal(ALPHA3_DSH_VERSION, '0.1.2-alpha.3')
  const props = alpha3PageProps({ sessionId: 's1', path: '/ws/a' })
  for (const key of ALPHA3_PAGE_PROP_KEYS) assert.ok(key in props, key)
  assert.equal('useSessions' in props, false)
  assert.equal('scope' in props, false)
})

test('production code must not read props.useSessions or slots.select', () => {
  const hits = []
  for (const file of productionSources()) {
    const src = readFileSync(file, 'utf8')
    if (/\.useSessions\b|props\?\.useSessions|useSessions:/.test(src)) hits.push(`${file}: useSessions`)
    if (/slots\.select|slotsApi\.select/.test(src)) hits.push(`${file}: slots.select`)
  }
  assert.deepEqual(hits, [], 'alpha.3 production must not use removed Harness APIs:\n' + hits.join('\n'))
})

test('sessionCwd resolves path from useWorkspaces items by sessionId', () => {
  const props = alpha3PageProps({ sessionId: 's1', path: '/ws/alpha' })
  assert.equal(sessionCwd(props), '/ws/alpha')
})

test('sessionCwd maps one workspace to many sessions and isolates two workspaces', () => {
  const shared = alpha3Workspace({ workspaceId: 'shared', path: '/ws/shared', sessionIds: ['sa', 'sb'] })
  const other = alpha3Workspace({ workspaceId: 'other', path: '/ws/other', sessionIds: ['sc'] })
  const items = [shared, other]
  assert.equal(sessionCwd(alpha3PageProps({ sessionId: 'sa', items })), '/ws/shared')
  assert.equal(sessionCwd(alpha3PageProps({ sessionId: 'sb', items })), '/ws/shared')
  assert.equal(sessionCwd(alpha3PageProps({ sessionId: 'sc', items })), '/ws/other')
})

test('sessionCwd is empty when the session is not in any workspace', () => {
  const props = alpha3PageProps({
    sessionId: 'missing',
    items: [alpha3Workspace({ sessionId: 's1', path: '/ws/a' })],
  })
  assert.equal(sessionCwd(props), '')
})

test('sessionCwd follows a session that moves from workspace A to B', () => {
  const first = alpha3PageProps({
    sessionId: 's1',
    items: [alpha3Workspace({ workspaceId: 'a', path: '/ws/a', sessionIds: ['s1'] })],
  })
  assert.equal(sessionCwd(first), '/ws/a')
  const moved = alpha3PageProps({
    sessionId: 's1',
    items: [
      alpha3Workspace({ workspaceId: 'a', path: '/ws/a', sessionIds: [] }),
      alpha3Workspace({ workspaceId: 'b', path: '/ws/b', sessionIds: ['s1'] }),
    ],
  })
  assert.equal(sessionCwd(moved), '/ws/b')
})

test('useSessionCwd matches sessionCwd for the same alpha.3 props', () => {
  const props = alpha3PageProps({ sessionId: 's9', path: '/ws/hook' })
  assert.equal(useSessionCwd(null, props), sessionCwd(props))
  assert.equal(useSessionCwd(null, props), '/ws/hook')
})

test('scope.cwd remains a documented short-term fallback', () => {
  const props = { ...alpha3PageProps({ sessionId: 's1', items: [] }), scope: { cwd: '/legacy/scope' } }
  assert.equal(sessionCwd(props), '/legacy/scope')
})
