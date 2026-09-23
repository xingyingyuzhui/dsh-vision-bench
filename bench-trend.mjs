// Compatibility facade — prefer src/domain/modbus/trend-model.mjs.
export {
  TREND_CAP,
  TREND_WINDOW_MS,
  getTrendState,
  clearTrendState,
  TREND,
  trendKey,
  sampleTrend,
  computeStats,
  exportRangeCsv,
  toUplotData,
  trendDataForComponents,
  componentLatestValues,
  UPLOT_PROTO,
} from './src/domain/modbus/trend-model.mjs'
