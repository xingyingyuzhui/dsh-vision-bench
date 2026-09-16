/**
 * Compat exports that are intentionally not pure re-exports (P5-3).
 * Remove entries as facades are migrated into src/.
 *
 * @type {Record<string, { reason: string, stage: string, exports?: string[] }>}
 */
export const FACADE_COMPAT_ALLOWLIST = {
  'bench-actions.mjs': {
    reason: 'listDir thin wrapper pending move into src/infrastructure/files',
    stage: 'P6',
    exports: ['listDir'],
  },
  'bench-listdir.mjs': {
    reason: 'cwd guard + listDir wrapper; migrate with project-fs helpers',
    stage: 'P6',
  },
  'bench-live.mjs': {
    reason: 'TAB_LOG compat constant registered for clients',
    stage: 'P7',
    exports: ['TAB_LOG'],
  },
  'bench-modbus-forward.mjs': {
    reason: 'agent-stable surface still re-exports other bench-* facades',
    stage: 'P6',
  },
}
