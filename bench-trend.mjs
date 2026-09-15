// Compatibility facade — prefer src/application/modbus/trend-model.mjs.
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
} from './src/application/modbus/trend-model.mjs'
