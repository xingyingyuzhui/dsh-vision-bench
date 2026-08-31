// Sidebar pin / scope / focus-routing helpers (split from bench-shared).
const SIDEBAR_PIN = new Map() // cwd -> { connectionId, deviceId, pinned:boolean }

export function getSidebarPin(cwd) {
  return SIDEBAR_PIN.get(cwd) || null
}
export function setSidebarPin(cwd, pin) {
  if (!pin || !pin.pinned) {
    SIDEBAR_PIN.delete(cwd)
    return null
  }
  const v = {
    connectionId: String(pin.connectionId || ''),
    deviceId: String(pin.deviceId || ''),
    pinned: true,
  }
  SIDEBAR_PIN.set(cwd, v)
  return v
}
export function clearSidebarPin(cwd) {
  SIDEBAR_PIN.delete(cwd)
}
export function resolveSidebarScope(cwd, activeConnectionId, activeDeviceId) {
  const pin = SIDEBAR_PIN.get(cwd)
  if (pin?.pinned && pin.connectionId) {
    return { connectionId: pin.connectionId, deviceId: pin.deviceId || '', pinned: true, follow: false }
  }
  return {
    connectionId: String(activeConnectionId || ''),
    deviceId: String(activeDeviceId || ''),
    pinned: false,
    follow: true,
  }
}
export function filterByScope(list, scope, getIds) {
  if (!Array.isArray(list)) return []
  if (!scope || !scope.connectionId) return list
  return list.filter((item) => {
    const ids = typeof getIds === 'function' ? getIds(item) : item
    const cid = (ids && (ids.connectionId || ids.connId)) || ''
    const did = ids?.deviceId || ''
    if (cid !== scope.connectionId) return false
    if (scope.deviceId && did && did !== scope.deviceId) return false
    return true
  })
}

export { shouldRouteFocus } from '../workspace/vision-route.mjs'
