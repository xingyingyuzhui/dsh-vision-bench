export { createAlarmPage } from './src/ui/monitor/alarms/alarm-page.mjs'
export { createLogPage } from './src/ui/monitor/journal/journal-page.mjs'
export {
  createVisualizationPage,
  createVisualizationPage as createTrendPage,
} from './src/ui/monitor/visualization/visualization-page.mjs'
export { sessionCwd } from './src/ui/common/session-scope.mjs'

export const TAB_LOG = 'dsh-vision-bench:log'
