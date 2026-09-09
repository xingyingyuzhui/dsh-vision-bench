import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { PRESERVE_NAV_STORAGE_KEY, getPreserveNavPreference, setPreserveNavPreference } from '../bench-settings.mjs'
import { decodeValue } from '../src/domain/modbus/point-math.mjs'
import { getLastHmiTab, setLastHmiTab } from '../src/ui/hmi/hooks/use-connections.mjs'

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
      m.delete(String(key))
    },
    clear() {
      m.clear()
    },
  }
}

let originalWindow

beforeEach(() => {
  originalWindow = globalThis.window
  const local = memoryStorage()
  const session = memoryStorage()
  globalThis.window = {
    localStorage: local,
    sessionStorage: session,
  }
})

afterEach(() => {
  globalThis.window = originalWindow
})

test('navigation preference defaults to false and can be toggled', () => {
  assert.equal(getPreserveNavPreference(), false)
  setPreserveNavPreference(true)
  assert.equal(getPreserveNavPreference(), true)
  assert.equal(window.localStorage.getItem(PRESERVE_NAV_STORAGE_KEY), 'true')
  setPreserveNavPreference(false)
  assert.equal(getPreserveNavPreference(), false)
})

test('getLastHmiTab returns all when preference is disabled', () => {
  setPreserveNavPreference(false)
  setLastHmiTab('/ws', 'conn-1')
  // Even if sessionStorage had a value, preference is false, so it returns 'all'
  assert.equal(getLastHmiTab('/ws'), 'all')
})

test('getLastHmiTab restores saved connection when preference is enabled', () => {
  setPreserveNavPreference(true)
  setLastHmiTab('/ws', 'conn-modbus-01')
  assert.equal(getLastHmiTab('/ws'), 'conn-modbus-01')

  // Switching back to overview clears the stored connection
  setLastHmiTab('/ws', 'all')
  assert.equal(getLastHmiTab('/ws'), 'all')
})

test('decodeValue rounds floats to prevent IEEE-754 precision artifacts', () => {
  // Test raw: 29615, scale: 0.01 -> 296.15 (not 296.15000000000003)
  const decoded = decodeValue({ scale: 0.01 }, 29615)
  assert.equal(decoded, 296.15)
  assert.equal(String(decoded), '296.15')

  // Negative float
  const decodedNeg = decodeValue({ scale: 0.01 }, -505)
  assert.equal(decodedNeg, -5.05)
})

test('getLastEditingPointsDeviceId restores saved device when preference is enabled', async () => {
  const { getLastEditingPointsDeviceId, setLastEditingPointsDeviceId } = await import(
    '../src/ui/hmi/hooks/use-points.mjs'
  )
  setPreserveNavPreference(false)
  setLastEditingPointsDeviceId('/ws', 'c1', 'd1')
  assert.equal(getLastEditingPointsDeviceId('/ws', 'c1'), '')

  setPreserveNavPreference(true)
  assert.equal(getLastEditingPointsDeviceId('/ws', 'c1'), 'd1')

  setLastEditingPointsDeviceId('/ws', 'c1', '')
  assert.equal(getLastEditingPointsDeviceId('/ws', 'c1'), '')
})
