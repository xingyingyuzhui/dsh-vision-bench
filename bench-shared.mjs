// Compatibility facade — implementations live under src/ui/common/*.
// Prefer importing from those modules in new code. Do not add new logic here.

export {
  clockOf,
  emptyWorkspace,
  emptyJournal,
  pickJournal,
  runningOf,
  runningSource,
  formatClock,
  sourceLabel,
  statusLabel,
  typeLabel,
  field,
  statusBar,
  visionCollabBar,
  journalPanel,
  lineKind,
} from './src/ui/common/ui-format.mjs'
export { POLL_MS, stateBusKey, subscribeState } from './src/ui/common/state-subscription.mjs'
export { pushFramesLog, getFramesLog, clearFramesLog, framesLogCount } from './src/ui/common/frame-cache.mjs'
export {
  getSidebarPin,
  setSidebarPin,
  clearSidebarPin,
  resolveSidebarScope,
  filterByScope,
  shouldRouteFocus,
} from './src/ui/common/sidebar-scope.mjs'
export {
  getFocusState,
  setFocusState,
  subscribeFocus,
  isFocusTarget,
  focusHighlightClass,
  setTempWatch,
  getTempWatch,
  clearTempWatch,
  hasTempWatch,
  isForegroundTask,
  shouldStealFocus,
  shouldHighlightFocus,
} from './src/ui/common/focus-store.mjs'
export {
  parseTrendKey,
  buildAgentRef,
  evidenceFromRef,
  postEvidence,
  agentRefToText,
  copyAgentRef,
  readInputDraft,
  buildInputBridge,
  dispatchAgentRef,
  hasHarnessInput,
} from './src/ui/common/agent-reference.mjs'
export {
  sessionCwd,
  pageSessionId,
  useSessionCwd,
  setActiveScope,
  clearActiveScope,
  getActiveScope,
} from './src/ui/common/session-scope.mjs'
