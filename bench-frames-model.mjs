// Compatibility facade — prefer src/domain/modbus/frames-model.mjs.
export {
  parseFramePortSelection,
  buildFramePortOptions,
  selectProtocolFrames,
  mergeFramesDedup,
  framesShouldStickToBottom,
  framesShouldStickToTop,
  countAddedFrameIds,
  frameStreamKey,
  rawLineId,
  resolveFrameSelection,
} from './src/domain/modbus/frames-model.mjs'
