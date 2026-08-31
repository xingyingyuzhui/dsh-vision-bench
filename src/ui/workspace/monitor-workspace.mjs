import { createFramesPage } from '../../../bench-frames-view.mjs'
import { createAlarmPage, createLogPage } from '../../../bench-live.mjs'
import { createVisualizationPage } from '../../../bench-visualization-view.mjs'
import { sessionCwd } from '../common/session-scope.mjs'
import { getNav, navigate, subscribeNav } from './vision-navigation-store.mjs'
import { MONITOR_SECTIONS, VIEW_MONITOR, isMonitorSection } from './vision-route.mjs'
import { renderWorkspaceTabs } from './workspace-tabs.mjs'

function initialSection(sessionId, cwd) {
  const nav = getNav(sessionId, cwd)
  if (nav && nav.viewId === VIEW_MONITOR && isMonitorSection(nav.section)) return nav.section
  return MONITOR_SECTIONS.VISUALIZATION
}

export function createMonitorWorkspace(React, t, post, hooks) {
  const VizPage = createVisualizationPage(React, t, post, { openHmi: hooks?.openHmi })
  const AlarmPage = createAlarmPage(React, t, post, { openHmi: hooks?.openHmi })
  const FramesPage = createFramesPage(React, t, post, { openHmi: hooks?.openHmi })
  const LogPage = createLogPage(React, t, post, {
    openHmi: hooks?.openHmi,
    openFrames: hooks?.openFrames,
  })
  const pages = {
    [MONITOR_SECTIONS.VISUALIZATION]: VizPage,
    [MONITOR_SECTIONS.ALARMS]: AlarmPage,
    [MONITOR_SECTIONS.FRAMES]: FramesPage,
    [MONITOR_SECTIONS.JOURNAL]: LogPage,
  }
  const labels = {
    [MONITOR_SECTIONS.VISUALIZATION]: t('liveChart'),
    [MONITOR_SECTIONS.ALARMS]: t('liveAlarm'),
    [MONITOR_SECTIONS.FRAMES]: t('framesTab'),
    [MONITOR_SECTIONS.JOURNAL]: t('liveLog'),
  }
  const sections = [
    MONITOR_SECTIONS.VISUALIZATION,
    MONITOR_SECTIONS.ALARMS,
    MONITOR_SECTIONS.FRAMES,
    MONITOR_SECTIONS.JOURNAL,
  ]

  return function MonitorWorkspace(props) {
    const el = React.createElement
    const sessionId = props?.sessionId || ''
    const cwd = sessionCwd(props)
    const [section, setSection] = React.useState(() => initialSection(sessionId, cwd))
    React.useEffect(() => {
      setSection(initialSection(sessionId, cwd))
      return subscribeNav(sessionId, cwd, (nav) => {
        if (nav && nav.viewId === VIEW_MONITOR && isMonitorSection(nav.section)) setSection(nav.section)
      })
    }, [sessionId, cwd])
    const Page = pages[section] || VizPage
    return el(
      'div',
      { className: 'dvb-workspace', 'data-workspace': 'monitor', 'data-section': section },
      renderWorkspaceTabs(el, {
        sections,
        active: section,
        labels,
        onSelect(id) {
          setSection(id)
          navigate(sessionId, cwd, { viewId: VIEW_MONITOR, section: id })
        },
      }),
      el('div', { className: 'dvb-ws-body' }, el(Page, props)),
    )
  }
}
