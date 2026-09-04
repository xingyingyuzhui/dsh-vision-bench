export const VIEW_DEBUG = 'vision-bench-debug'
export const VIEW_HMI = 'vision-bench-hmi'
export const VIEW_MONITOR = 'vision-bench-monitor'

export const MONITOR_SECTIONS = {
  VISUALIZATION: 'visualization',
  ALARMS: 'alarms',
  FRAMES: 'frames',
  JOURNAL: 'journal',
}

export const DEBUG_SECTIONS = {
  WORKBENCH: 'workbench',
  PROJECT: 'project',
  RUNTIME: 'runtime',
}

const MONITOR_SECTION_SET = new Set(Object.values(MONITOR_SECTIONS))
const DEBUG_SECTION_SET = new Set(Object.values(DEBUG_SECTIONS))

export function isMonitorSection(id) {
  return MONITOR_SECTION_SET.has(id)
}

export function isDebugSection(id) {
  return DEBUG_SECTION_SET.has(id)
}

function targetOf(req) {
  const r = req && typeof req === 'object' ? req : {}
  return {
    connectionId: String(r.connectionId || ''),
    deviceId: String(r.deviceId || ''),
    pointId: String(r.pointId || ''),
    frameId: String(r.frameId || ''),
    alarmId: String(r.alarmId || ''),
    visualizationId: String(r.visualizationId || ''),
    trendKey: String(r.trendKey || ''),
    file: String(r.file || ''),
    line: Number(r.line) || 0,
    debugSessionId: String(r.debugSessionId || ''),
    breakpointId: String(r.breakpointId || ''),
    watchpointId: String(r.watchpointId || ''),
    snapshotId: String(r.snapshotId || ''),
  }
}

export function focusKindOf(focus) {
  const fs = focus || {}
  const req = fs.request && typeof fs.request === 'object' ? fs.request : {}
  return (
    fs.kind ||
    req.kind ||
    (req.frameId ? 'frame' : '') ||
    (req.visualizationId ? 'visualization' : '') ||
    (req.trendKey ? 'trend' : '') ||
    (req.alarmId ? 'alarm' : '') ||
    (req.taskId || req.journalId ? 'journal' : '') ||
    (req.debugSessionId || req.breakpointId || req.watchpointId || req.snapshotId ? 'runtime' : '') ||
    (req.file || req.function || req.build ? 'file' : '') ||
    (req.pointId || req.connectionId || req.deviceId ? 'point' : '') ||
    'point'
  )
}

export function routeForKind(kind) {
  if (kind === 'trend' || kind === 'visualization') {
    return { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.VISUALIZATION, tab: 'trend' }
  }
  if (kind === 'alarm') {
    return { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.ALARMS, tab: 'alarm' }
  }
  if (kind === 'frame') {
    return { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.FRAMES, tab: 'frames' }
  }
  if (kind === 'journal' || kind === 'task') {
    return { viewId: VIEW_MONITOR, section: MONITOR_SECTIONS.JOURNAL, tab: 'journal' }
  }
  if (
    kind === 'debug' ||
    kind === 'breakpoint' ||
    kind === 'watchpoint' ||
    kind === 'snapshot' ||
    kind === 'debug-event' ||
    kind === 'runtime'
  ) {
    return { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.RUNTIME, tab: 'runtime' }
  }
  if (kind === 'file' || kind === 'function' || kind === 'build') {
    return { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, tab: 'project' }
  }
  return { viewId: VIEW_HMI, section: '', tab: 'table' }
}

/**
 * Foreground Agent focus → native workspace + section.
 * `tab` is a compatibility alias for the old sidebar names.
 */
export function shouldRouteFocus({ activeCwd, activeSessionId, changedCwd, focus, previousRouteKey }) {
  if (!activeCwd) return { route: false, routeKey: '', tab: '', viewId: '', section: '', target: targetOf(null) }
  if (changedCwd && changedCwd !== activeCwd) {
    return {
      route: false,
      routeKey: previousRouteKey || '',
      tab: '',
      viewId: '',
      section: '',
      target: targetOf(null),
    }
  }
  const fs = focus || {}
  const req = fs.request
  const focusSessionId = String(fs.sessionId || req?.sessionId || '')
  if (activeSessionId != null && focusSessionId !== String(activeSessionId || '')) {
    return {
      route: false,
      routeKey: previousRouteKey || '',
      tab: '',
      viewId: '',
      section: '',
      target: targetOf(req),
    }
  }
  if (!req || typeof req !== 'object') {
    return {
      route: false,
      routeKey: previousRouteKey || '',
      tab: '',
      viewId: '',
      section: '',
      target: targetOf(null),
    }
  }
  if (fs.badgeOnly === true) {
    return {
      route: false,
      routeKey: previousRouteKey || '',
      tab: '',
      viewId: '',
      section: '',
      target: targetOf(req),
    }
  }
  if (fs.foreground === false && req.foreground === undefined) {
    return {
      route: false,
      routeKey: previousRouteKey || '',
      tab: '',
      viewId: '',
      section: '',
      target: targetOf(req),
    }
  }
  const kind = focusKindOf(fs)
  const target = targetOf(req)
  const routeKey = [
    String(activeSessionId == null ? '' : activeSessionId),
    activeCwd,
    kind,
    target.connectionId,
    target.deviceId,
    target.pointId,
    target.frameId,
    target.trendKey,
    target.visualizationId,
    target.alarmId,
    target.file,
    target.line,
  ].join('|')
  const mapped = routeForKind(kind)
  if (previousRouteKey && previousRouteKey === routeKey) {
    return { route: false, routeKey, tab: '', viewId: mapped.viewId, section: mapped.section, target }
  }
  return { route: true, routeKey, tab: mapped.tab, viewId: mapped.viewId, section: mapped.section, target }
}
