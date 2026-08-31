import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearSidebarPin,
  filterByScope,
  resolveSidebarScope,
  setSidebarPin,
  shouldRouteFocus,
} from '../src/ui/common/sidebar-scope.mjs'

test('resolveSidebarScope follows HMI active ids when unpinned', async () => {
  clearSidebarPin('/ws')
  assert.deepEqual(resolveSidebarScope('/ws', 'c1', 'd1'), {
    connectionId: 'c1',
    deviceId: 'd1',
    pinned: false,
    follow: true,
  })
})

test('resolveSidebarScope prefers pinned connection', async () => {
  setSidebarPin('/ws', { pinned: true, connectionId: 'c9', deviceId: 'd9' })
  assert.deepEqual(resolveSidebarScope('/ws', 'c1', 'd1'), {
    connectionId: 'c9',
    deviceId: 'd9',
    pinned: true,
    follow: false,
  })
  clearSidebarPin('/ws')
})

test('filterByScope keeps matching connection/device rows', async () => {
  const rows = [
    { connectionId: 'c1', deviceId: 'd1', id: 'a' },
    { connectionId: 'c1', deviceId: 'd2', id: 'b' },
    { connectionId: 'c2', deviceId: 'd1', id: 'c' },
  ]
  assert.deepEqual(
    filterByScope(rows, { connectionId: 'c1', deviceId: 'd1' }).map((r) => r.id),
    ['a'],
  )
  assert.deepEqual(
    filterByScope(rows, { connectionId: 'c1' }).map((r) => r.id),
    ['a', 'b'],
  )
})

test('shouldRouteFocus routes visualization to trend tab once per key', async () => {
  const focus = {
    badgeOnly: false,
    request: { kind: 'visualization', visualizationId: 'viz_1', connectionId: 'c1' },
  }
  const first = shouldRouteFocus({ activeCwd: '/ws', changedCwd: '/ws', focus, previousRouteKey: '' })
  assert.equal(first.route, true)
  assert.equal(first.tab, 'trend')
  assert.equal(first.viewId, 'vision-bench-monitor')
  assert.equal(first.section, 'visualization')
  const second = shouldRouteFocus({
    activeCwd: '/ws',
    changedCwd: '/ws',
    focus,
    previousRouteKey: first.routeKey,
  })
  assert.equal(second.route, false)
})
