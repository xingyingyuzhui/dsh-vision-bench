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

function emptyRoute() {
  return { viewId: '', section: '', target: {} }
}

function cloneRoute(route) {
  const value = normalizeRoute(route)
  return { viewId: value.viewId, section: value.section, target: { ...(value.target || {}) } }
}

function shape(rec) {
  const active = rec.active || emptyRoute()
  return {
    viewId: active.viewId,
    section: active.section,
    target: active.target,
    preferred: rec.preferred || active,
    active,
    agentReturn: rec.agentReturn || null,
    leaseUntil: Number(rec.leaseUntil) || 0,
    at: rec.at || 0,
  }
}

function blankRec(now) {
  return {
    preferred: emptyRoute(),
    active: emptyRoute(),
    agentReturn: null,
    leaseUntil: 0,
    at: now,
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
    agentReturn: rec.agentReturn || null,
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
    const preferred = normalizeRoute(item.preferred || item)
    const active = normalizeRoute(item.active || item)
    const agentReturn = item.agentReturn ? normalizeRoute(item.agentReturn) : null
    NAV.set(item.key, {
      preferred,
      active,
      agentReturn: agentReturn?.viewId ? agentReturn : null,
      leaseUntil: Number(item.leaseUntil) || 0,
      at: Number(item.at) || 0,
    })
  }
  trimLru()
}

function commit(key, rec) {
  NAV.set(key, rec)
  persist()
  const payload = shape(rec)
  notify([key], payload)
  return payload
}

export function getNav(sessionId, cwd) {
  hydrate()
  const exact = NAV.get(navKey(sessionId, cwd))
  return exact ? shape(exact) : null
}

export function isManualNavLeaseActive(sessionId, cwd, now) {
  hydrate()
  const rec = NAV.get(navKey(sessionId, cwd))
  if (!rec) return false
  const t = typeof now === 'number' ? now : nowFn()
  return Number(rec.leaseUntil) > t
}

function sourceOf(opts) {
  const source = opts?.source
  if (source === 'manual' || source === 'init' || source === 'restore' || source === 'agent') return source
  return 'agent'
}

export function navigate(sessionId, cwd, route, opts = {}) {
  hydrate()
  const now = currentNow(opts)
  const source = sourceOf(opts)
  const value = normalizeRoute(route)
  const key = navKey(sessionId, cwd)
  const existing = NAV.get(key)

  if (source === 'init') {
    if (existing) return { ...shape(existing), applied: false }
    if (!value.viewId) return null
    const rec = {
      preferred: cloneRoute(value),
      active: cloneRoute(value),
      agentReturn: null,
      leaseUntil: 0,
      at: now,
    }
    return { ...commit(key, rec), applied: true }
  }

  if (source === 'restore') {
    return restoreNav(sessionId, cwd, opts)
  }

  if (!value.viewId) {
    const current = existing ? shape(existing) : null
    return current ? { ...current, applied: false } : null
  }

  if (source === 'manual') {
    const rec = existing || blankRec(now)
    rec.preferred = cloneRoute(value)
    rec.active = cloneRoute(value)
    rec.agentReturn = null
    rec.leaseUntil = now + MANUAL_NAV_LEASE_MS
    rec.at = now
    return { ...commit(key, rec), applied: true }
  }

  // Agent: blocked requests must not mutate any location fields.
  if (existing && Number(existing.leaseUntil) > now) {
    return { ...shape(existing), applied: false }
  }

  const rec = existing || blankRec(now)
  if (!rec.agentReturn) {
    const from = rec.active?.viewId ? rec.active : rec.preferred
    rec.agentReturn = from?.viewId ? cloneRoute(from) : null
  }
  rec.active = cloneRoute(value)
  rec.leaseUntil = 0
  rec.at = now
  return { ...commit(key, rec), applied: true }
}

export function restoreNav(sessionId, cwd, opts = {}) {
  hydrate()
  const now = currentNow(opts)
  const key = navKey(sessionId, cwd)
  const rec = NAV.get(key)
  if (!rec) return null
  const target = rec.agentReturn || rec.preferred
  const value = normalizeRoute(target)
  rec.agentReturn = null
  rec.at = now
  if (!value.viewId) {
    return { ...commit(key, rec), applied: false }
  }
  rec.active = cloneRoute(value)
  rec.leaseUntil = now + MANUAL_NAV_LEASE_MS
  return { ...commit(key, rec), applied: true }
}

export function restoreUserLocation(sessionId, cwd, opts = {}) {
  return restoreNav(sessionId, cwd, opts)
}

export function subscribeNav(sessionId, cwd, fn) {
  if (typeof fn !== 'function') return () => {}
  hydrate()
  const key = navKey(sessionId, cwd)
  listenersOf(key).add(fn)
  return () => {
    const set = LISTENERS.get(key)
    if (set) set.delete(fn)
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
