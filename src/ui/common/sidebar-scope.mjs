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

export function shouldRouteFocus({ activeCwd, changedCwd, focus, previousRouteKey }) {
  if (!activeCwd) return { route: false, routeKey: '', tab: '' }
  if (changedCwd && changedCwd !== activeCwd) return { route: false, routeKey: previousRouteKey || '', tab: '' }
  const fs = focus || {}
  const req = fs.request
  if (!req || typeof req !== 'object') return { route: false, routeKey: previousRouteKey || '', tab: '' }
  if (fs.badgeOnly === true) return { route: false, routeKey: previousRouteKey || '', tab: '' }
  if (fs.foreground === false && req.foreground === undefined)
    return { route: false, routeKey: previousRouteKey || '', tab: '' }
  // specific target ids win over the generic connection/point bucket
  const kind =
    fs.kind ||
    req.kind ||
    '' ||
    (req.frameId ? 'frame' : '') ||
    (req.visualizationId ? 'visualization' : '') ||
    (req.trendKey ? 'trend' : '') ||
    (req.alarmId ? 'alarm' : '') ||
    (req.pointId || req.connectionId || req.deviceId ? 'point' : '') ||
    'point'
  // routeKey MUST include cwd and every target id so same-target polls are
  // deduplicated and different cwds with identical ids never collide.
  const routeKey = [
    activeCwd,
    kind,
    String(req.connectionId || ''),
    String(req.deviceId || ''),
    String(req.pointId || ''),
    String(req.frameId || ''),
    String(req.trendKey || ''),
    String(req.visualizationId || ''),
    String(req.alarmId || ''),
  ].join('|')
  if (previousRouteKey && previousRouteKey === routeKey) return { route: false, routeKey, tab: '' }
  let tab = ''
  if (kind === 'trend' || kind === 'visualization') tab = 'trend'
  else if (kind === 'alarm') tab = 'alarm'
  else if (kind === 'frame') tab = 'frames'
  else tab = 'table'
  return { route: true, routeKey, tab }
}
