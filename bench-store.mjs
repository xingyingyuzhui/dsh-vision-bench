// Compatibility facade: delegates domain persistence to dedicated infrastructure submodules.
// Maintains 100% backward compatibility for existing callers and test suites.

export {
  BINDING_KEYS,
  emptyBindings,
  defaultDshHome,
  storeDir,
  bindingsPath,
  normalizeBindings,
  validateBindings,
  probePath,
  probeBindings,
  loadBindings,
  saveBindings,
} from './src/infrastructure/store/bindings-store.mjs'

export {
  globalSharePath,
  emptyGlobalShare,
  normalizeGlobalShare,
  loadGlobalShare,
  saveGlobalShare,
} from './src/infrastructure/store/global-share-store.mjs'

export {
  emptyFocusState,
  normalizeFocusRequest,
  normalizeFocusState,
} from './src/infrastructure/store/focus-store.mjs'

export {
  emptyWorkspace,
  workspaceKey,
  workspaceRepository,
  workspacePath,
  normalizeWorkspace,
  loadWorkspace,
  applyWorkspacePatch,
  saveWorkspace,
  saveWorkspaceAsync,
  seedWorkspaceForTestSync,
  stringifyConfigSlice,
} from './src/infrastructure/store/workspace-store.mjs'

export {
  recordBenchEvent,
  openTask,
  openExclusiveTask,
  finishTask,
  journalView,
  bindSession,
  touchServiceSession,
  unbindSession,
  createManualRequest,
  resolveManualRequest,
  sweepStaleTasks,
  pruneBuildLogs,
  clearFramesByConnection,
  appendEvidence,
} from './src/infrastructure/store/journal-store.mjs'
