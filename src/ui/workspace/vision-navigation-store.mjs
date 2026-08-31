import { VIEW_DEBUG, VIEW_HMI, VIEW_MONITOR, isDebugSection, isMonitorSection } from './vision-route.mjs'

export const MANUAL_NAV_LEASE_MS = 10000
export const NAV_LRU_LIMIT = 64
export const NAV_STORAGE_KEY = 'dsh-vision-bench:nav'

const NAV = new Map()
const LISTENERS = new Map()

let hydrated = false
let storageOverride = null
let nowFn = () => Date.now()

export function navKey(sessionId, cwd) {
  return `${String(sessionId || '')}\0${String(cwd || '')}`
}

export function setNavNow(fn) {
  nowFn = typeof fn === 'function' ? fn : () => Date.now()
}

export function setNavStorage(storage) {
  storageOverride = storage || null
  hydrated = false
}

function currentNow(opts) {
  if (opts && typeof opts.now === 'number') return opts.now
  return nowFn()
}

function sessionStore() {
  if (storageOverride) return storageOverride
  try {
    if (typeof globalThis.sessionStorage !== 'undefined' && globalThis.sessionStorage) return globalThis.sessionStorage
  } catch {}
  return null
}

function listenersOf(key) {
  let set = LISTENERS.get(key)
  if (!set) {
    set = new Set()
    LISTENERS.set(key, set)
  }
  return set
}

function notify(keys, value) {
  const seen = new Set()
  for (const key of keys) {
    for (const fn of Array.from(listenersOf(key))) {
      if (seen.has(fn)) continue
      seen.add(fn)
      try {
        fn(value)
      } catch {}
    }
  }
}

function normalizeRoute(route) {
  const viewId =
    route && (route.viewId === VIEW_DEBUG || route.viewId === VIEW_HMI || route.viewId === VIEW_MONITOR)
      ? route.viewId
      : ''
  let section = route && typeof route.section === 'string' ? route.section : ''
  if (viewId === VIEW_MONITOR && !isMonitorSection(section)) section = 'visualization'
  if (viewId === VIEW_DEBUG && !isDebugSection(section)) section = 'workbench'
  if (viewId === VIEW_HMI) section = ''
  const target = route?.target && typeof route.target === 'object' ? route.target : {}
  return { viewId, section, target }
}

function shape(rec) {
  const active = rec.active || { viewId: '', section: '', target: {} }
  return {
    viewId: active.viewId,
    section: active.section,
    target: active.target,
    preferred: rec.preferred || active,
    active,
    leaseUntil: Number(rec.leaseUntil) || 0,
  }
}

function trimLru() {
  if (NAV.size <= NAV_LRU_LIMIT) return
  const ranked = [...NAV.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))
  while (NAV.size > NAV_LRU_LIMIT && ranked.length) {
    const [key] = ranked.shift()
    NAV.delete(key)
  }
}

function persist() {
  trimLru()
  const store = sessionStore()
  if (!store || typeof store.setItem !== 'function') return
  const items = [...NAV.entries()].map(([key, rec]) => ({
    key,
    preferred: rec.preferred,
    active: rec.active,
    leaseUntil: rec.leaseUntil || 0,
    at: rec.at || 0,
  }))
  try {
    store.setItem(NAV_STORAGE_KEY, JSON.stringify({ v: 1, items }))
  } catch {}
}

function hydrate() {
  if (hydrated) return
  hydrated = true
  const store = sessionStore()
  if (!store || typeof store.getItem !== 'function') return
  let parsed = null
  try {
    parsed = JSON.parse(store.getItem(NAV_STORAGE_KEY) || 'null')
  } catch {
    return
  }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return
  for (const item of parsed.items) {
    if (!item || typeof item.key !== 'string') continue
    NAV.set(item.key, {
      preferred: normalizeRoute(item.preferred || item),
      active: normalizeRoute(item.active || item),
      leaseUntil: Number(item.leaseUntil) || 0,
      at: Number(item.at) || 0,
    })
  }
  trimLru()
}

export function getNav(sessionId, cwd) {
  hydrate()
  const exact = NAV.get(navKey(sessionId, cwd))
  if (exact) return shape(exact)
  if (sessionId) {
    const fallback = NAV.get(navKey('', cwd))
    if (fallback) return shape(fallback)
  }
  return null
}

export function isManualNavLeaseActive(sessionId, cwd, now) {
  hydrate()
  const rec = NAV.get(navKey(sessionId, cwd)) || (sessionId ? NAV.get(navKey('', cwd)) : null)
  if (!rec) return false
  const t = typeof now === 'number' ? now : nowFn()
  return Number(rec.leaseUntil) > t
}

export function navigate(sessionId, cwd, route, opts = {}) {
  hydrate()
  const now = currentNow(opts)
  const source = opts.source === 'manual' ? 'manual' : 'agent'
  const value = normalizeRoute(route)
  if (!value.viewId) {
    const current = getNav(sessionId, cwd)
    return current ? { ...current, applied: false } : null
  }

  const key = navKey(sessionId, cwd)
  const rec = NAV.get(key) || {
    preferred: value,
    active: value,
    leaseUntil: 0,
    at: now,
  }
  rec.preferred = value
  rec.at = now

  let applied = true
  if (source === 'manual') {
    rec.active = value
    rec.leaseUntil = now + MANUAL_NAV_LEASE_MS
  } else if (Number(rec.leaseUntil) > now) {
    applied = false
  } else {
    rec.active = value
    rec.leaseUntil = 0
  }

  NAV.set(key, rec)
  const keys = [key]
  if (sessionId) {
    const fallback = navKey('', cwd)
    NAV.set(fallback, {
      preferred: rec.preferred,
      active: rec.active,
      leaseUntil: rec.leaseUntil,
      at: rec.at,
    })
    keys.push(fallback)
  }
  persist()
  const payload = shape(rec)
  notify(keys, payload)
  return { ...payload, applied }
}

export function subscribeNav(sessionId, cwd, fn) {
  if (typeof fn !== 'function') return () => {}
  hydrate()
  const keys = [navKey(sessionId, cwd)]
  if (sessionId) keys.push(navKey('', cwd))
  for (const key of keys) listenersOf(key).add(fn)
  return () => {
    for (const key of keys) {
      const set = LISTENERS.get(key)
      if (set) set.delete(fn)
    }
  }
}

export function clearNavStore() {
  NAV.clear()
  LISTENERS.clear()
  hydrated = false
  const store = sessionStore()
  if (store && typeof store.removeItem === 'function') {
    try {
      store.removeItem(NAV_STORAGE_KEY)
    } catch {}
  }
}
