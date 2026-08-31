import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MANUAL_NAV_LEASE_MS,
  NAV_LRU_LIMIT,
  NAV_STORAGE_KEY,
  clearNavStore,
  getNav,
  isManualNavLeaseActive,
  navigate,
  setNavNow,
  setNavStorage,
} from '../../src/ui/workspace/vision-navigation-store.mjs'
import { MONITOR_SECTIONS, VIEW_HMI, VIEW_MONITOR } from '../../src/ui/workspace/vision-route.mjs'

const storeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/workspace/vision-navigation-store.mjs'),
  'utf8',
)

function memoryStorage() {
  const m = new Map()
  return {
    getItem(key) {
      return m.has(key) ? m.get(key) : null
    },
    setItem(key, value) {
      m.set(String(key), String(value))
    },
    removeItem(key) {
      m.delete(key)
    },
  }
}

afterEach(() => {
  clearNavStore()
  setNavNow(null)
  setNavStorage(null)
})

test('nav store persists to sessionStorage and never mentions localStorage', () => {
  assert.match(storeSrc, /sessionStorage/)
  assert.doesNotMatch(storeSrc, /localStorage/)
  const mem = memoryStorage()
  setNavStorage(mem)
  navigate('s1', '/ws', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.FRAMES })
  const dumped = JSON.parse(mem.getItem(NAV_STORAGE_KEY))
  assert.equal(dumped.v, 1)
  assert.ok(dumped.items.some((item) => item.key === 's1\0/ws'))
  const snapshot = mem.getItem(NAV_STORAGE_KEY)
  clearNavStore()
  setNavStorage(mem)
  mem.setItem(NAV_STORAGE_KEY, snapshot)
  assert.equal(getNav('s1', '/ws').section, MONITOR_SECTIONS.FRAMES)
  assert.equal(getNav('s1', '/ws').preferred.section, MONITOR_SECTIONS.FRAMES)
})

test('manual nav lease blocks Agent apply for 10s and keeps preferred', () => {
  let now = 1_000_000
  setNavNow(() => now)
  navigate('s1', '/ws', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.VISUALIZATION }, { source: 'agent' })
  const manual = navigate('s1', '/ws', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.ALARMS }, { source: 'manual' })
  assert.equal(manual.applied, true)
  assert.equal(getNav('s1', '/ws').section, MONITOR_SECTIONS.ALARMS)
  assert.equal(isManualNavLeaseActive('s1', '/ws'), true)

  const blocked = navigate('s1', '/ws', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.FRAMES }, { source: 'agent' })
  assert.equal(blocked.applied, false)
  assert.equal(getNav('s1', '/ws').section, MONITOR_SECTIONS.ALARMS)
  assert.equal(getNav('s1', '/ws').preferred.section, MONITOR_SECTIONS.FRAMES)

  now += MANUAL_NAV_LEASE_MS - 1
  assert.equal(isManualNavLeaseActive('s1', '/ws'), true)
  now += 1
  assert.equal(isManualNavLeaseActive('s1', '/ws'), false)
  const after = navigate('s1', '/ws', { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.FRAMES }, { source: 'agent' })
  assert.equal(after.applied, true)
  assert.equal(getNav('s1', '/ws').section, MONITOR_SECTIONS.FRAMES)
})

test('LRU drops the oldest of 64 session keys', () => {
  assert.equal(NAV_LRU_LIMIT, 64)
  for (let i = 0; i < NAV_LRU_LIMIT + 1; i++) {
    navigate('', '/w' + i, { viewId: VIEW_HMI, section: '' }, { source: 'agent' })
  }
  assert.equal(getNav('', '/w0'), null)
  assert.ok(getNav('', '/w' + NAV_LRU_LIMIT))
})
