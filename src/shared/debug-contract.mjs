// @ts-check

/**
 * Connection RPC endpoints for Debug subsystem.
 */
export const DEBUG_RPC_ENDPOINTS = Object.freeze({
  STATE: 'debug/state',
  COMMAND: 'debug/command',
  EVENTS_WAIT: 'debug/events/wait',
  APPROVAL: 'debug/approval',
})

/**
 * Standard debug command operations.
 */
export const DEBUG_COMMAND_OPS = Object.freeze({
  START: 'start',
  STOP: 'stop',
  CONTINUE: 'continue',
  PAUSE: 'pause',
  STEP: 'step',
  RESET_HALT: 'resetHalt',
  ADD_BREAKPOINT: 'addBreakpoint',
  REMOVE_BREAKPOINT: 'removeBreakpoint',
  ADD_WATCHPOINT: 'addWatchpoint',
  REMOVE_WATCHPOINT: 'removeWatchpoint',
  EVALUATE: 'evaluate',
  STACK: 'stack',
  LOCALS: 'locals',
  REGISTERS: 'registers',
  READ_MEMORY: 'readMemory',
  SNAPSHOT: 'snapshot',
})

/**
 * Normalizes a source code location.
 * @param {any} loc
 * @returns {import('../types/debug.d.ts').SourceLocation | null}
 */
export function normalizeDebugLocation(loc) {
  if (!loc || typeof loc !== 'object') return null
  return {
    file: String(loc.file || '').trim(),
    line: Math.max(0, Number(loc.line) || 0),
    column: loc.column != null ? Math.max(0, Number(loc.column) || 0) : undefined,
    function: loc.function ? String(loc.function).trim() : undefined,
    address: loc.address ? String(loc.address).trim() : undefined,
  }
}

/**
 * Normalizes a debug stack frame.
 * @param {any} frame
 * @returns {import('../types/debug.d.ts').DebugStackFrame}
 */
export function normalizeDebugStackFrame(frame) {
  const row = frame && typeof frame === 'object' ? frame : {}
  return {
    level: Math.max(0, Number(row.level) || 0),
    function: String(row.function || '??').trim(),
    file: row.file ? String(row.file).trim() : undefined,
    line: row.line != null ? Math.max(0, Number(row.line) || 0) : undefined,
    address: row.address ? String(row.address).trim() : undefined,
  }
}

/**
 * Normalizes a debug variable.
 * @param {any} v
 * @returns {import('../types/debug.d.ts').DebugVariable}
 */
export function normalizeDebugVariable(v) {
  const row = v && typeof v === 'object' ? v : {}
  return {
    name: String(row.name || '').trim(),
    value: String(row.value || ''),
    type: row.type ? String(row.type).trim() : undefined,
    children: Array.isArray(row.children) ? row.children.map(normalizeDebugVariable) : undefined,
  }
}

/**
 * Normalizes a debug breakpoint.
 * @param {any} bp
 * @returns {import('../types/debug.d.ts').DebugBreakpoint}
 */
export function normalizeDebugBreakpoint(bp) {
  const row = bp && typeof bp === 'object' ? bp : {}
  return {
    id: String(row.id || ''),
    file: String(row.file || '').trim(),
    line: Math.max(0, Number(row.line) || 0),
    condition: row.condition ? String(row.condition).trim() : undefined,
    hitCount: row.hitCount != null ? Number(row.hitCount) : undefined,
    verified: Boolean(row.verified),
  }
}

/**
 * Normalizes a debug watchpoint.
 * @param {any} wp
 * @returns {import('../types/debug.d.ts').DebugWatchpoint}
 */
export function normalizeDebugWatchpoint(wp) {
  const row = wp && typeof wp === 'object' ? wp : {}
  return {
    id: String(row.id || ''),
    expression: String(row.expression || '').trim(),
    accessType: row.accessType === 'read' || row.accessType === 'readWrite' ? row.accessType : 'write',
    hitCount: row.hitCount != null ? Number(row.hitCount) : undefined,
    verified: Boolean(row.verified),
  }
}

/**
 * Normalizes a debug event DTO.
 * @param {any} ev
 * @returns {import('../types/debug.d.ts').DebugEvent}
 */
export function normalizeDebugEventDto(ev) {
  const row = ev && typeof ev === 'object' ? ev : {}
  return {
    id: String(row.id || ''),
    cursor: Math.max(0, Number(row.cursor) || 0),
    debugSessionId: String(row.debugSessionId || ''),
    workspaceCwd: String(row.workspaceCwd || ''),
    ownerSessionId: String(row.ownerSessionId || ''),
    timestamp: Number(row.timestamp) || Date.now(),
    type: String(row.type || ''),
    backend: row.backend || 'gdb-openocd',
    payload: row.payload || {},
  }
}

/**
 * Normalizes a DebugSessionView DTO.
 * @param {any} view
 * @returns {import('../types/debug.d.ts').DebugSessionView}
 */
export function normalizeDebugSessionViewDto(view) {
  const row = view && typeof view === 'object' ? view : {}
  return {
    debugSessionId: String(row.debugSessionId || ''),
    workspaceCwd: String(row.workspaceCwd || ''),
    ownerSessionId: String(row.ownerSessionId || ''),
    backend: row.backend || 'gdb-openocd',
    state: row.state || 'idle',
    location: normalizeDebugLocation(row.location),
    stack: Array.isArray(row.stack) ? row.stack.map(normalizeDebugStackFrame) : [],
    variables: Array.isArray(row.variables) ? row.variables.map(normalizeDebugVariable) : [],
    breakpoints: Array.isArray(row.breakpoints) ? row.breakpoints.map(normalizeDebugBreakpoint) : [],
    watchpoints: Array.isArray(row.watchpoints) ? row.watchpoints.map(normalizeDebugWatchpoint) : [],
    targetKey: String(row.targetKey || ''),
    createdAt: Number(row.createdAt) || Date.now(),
    updatedAt: Number(row.updatedAt) || Date.now(),
  }
}
