// @ts-check

/**
 * Creates a bounded debug snapshot for inspection and diagnostic evidence.
 * Parity with ADR-013 & Phase 2 snapshot schema.
 *
 * @param {Partial<import('../../types/debug.d.ts').DebugSnapshot> & { reason: string }} data
 * @returns {import('../../types/debug.d.ts').DebugSnapshot}
 */
export function createDebugSnapshot(data) {
  const id = data.id || `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    createdAt: data.createdAt || Date.now(),
    reason: String(data.reason || 'manual').slice(0, 120),
    location: data.location || null,
    stack: Array.isArray(data.stack) ? data.stack.slice(0, 32) : [],
    locals: Array.isArray(data.locals) ? data.locals.slice(0, 64) : [],
    watches: Array.isArray(data.watches) ? data.watches.slice(0, 32) : [],
    registers: Array.isArray(data.registers) ? data.registers.slice(0, 32) : undefined,
    selectedGlobals: Array.isArray(data.selectedGlobals) ? data.selectedGlobals.slice(0, 32) : undefined,
    sourceContext: typeof data.sourceContext === 'string' ? data.sourceContext.slice(0, 4000) : undefined,
    firmwareHash: data.firmwareHash ? String(data.firmwareHash).slice(0, 64) : '',
    backend: data.backend || 'gdb-openocd',
    breakpointId: data.breakpointId,
    watchpointId: data.watchpointId,
  }
}
