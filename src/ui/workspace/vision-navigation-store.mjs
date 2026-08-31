import { VIEW_DEBUG, VIEW_HMI, VIEW_MONITOR, isDebugSection, isMonitorSection } from './vision-route.mjs'

const NAV = new Map()
const LISTENERS = new Map()

export function navKey(sessionId, cwd) {
  return `${String(sessionId || '')}\0${String(cwd || '')}`
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

export function getNav(sessionId, cwd) {
  const exact = NAV.get(navKey(sessionId, cwd))
  if (exact) return exact
  if (sessionId) return NAV.get(navKey('', cwd)) || null
  return null
}

export function navigate(sessionId, cwd, route) {
  const value = normalizeRoute(route)
  if (!value.viewId) return getNav(sessionId, cwd)
  const key = navKey(sessionId, cwd)
  const keys = [key]
  NAV.set(key, value)
  if (sessionId) {
    const fallback = navKey('', cwd)
    NAV.set(fallback, value)
    keys.push(fallback)
  }
  notify(keys, value)
  return value
}

export function subscribeNav(sessionId, cwd, fn) {
  if (typeof fn !== 'function') return () => {}
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
}
