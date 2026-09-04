import { createDebugView } from '../../../bench-view.mjs'
import { sessionCwd } from '../common/session-scope.mjs'
import { createMapView } from '../debug/project/project-page.mjs'
import { createRuntimePage } from '../debug/runtime/runtime-page.mjs'
import { getNav, navigate, subscribeNav } from './vision-navigation-store.mjs'
import { DEBUG_SECTIONS, VIEW_DEBUG, isDebugSection } from './vision-route.mjs'
import { renderWorkspaceTabs } from './workspace-tabs.mjs'

function initialSection(sessionId, cwd) {
  const nav = getNav(sessionId, cwd)
  if (nav && nav.viewId === VIEW_DEBUG && isDebugSection(nav.section)) return nav.section
  return DEBUG_SECTIONS.WORKBENCH
}

export function createDebugWorkspace(React, t, post) {
  const openProjectRef = { current: () => {} }
  const WorkbenchPage = createDebugView(React, t, post, (target) => openProjectRef.current(target))
  const ProjectPage = createMapView(React, t, post)
  const RuntimePage = createRuntimePage(React, t, post)
  const labels = {
    [DEBUG_SECTIONS.WORKBENCH]: t('sectionWorkbench') || t('tabDebug'),
    [DEBUG_SECTIONS.PROJECT]: t('projectMap'),
    [DEBUG_SECTIONS.RUNTIME]: t('sectionRuntime') || '运行调试',
  }
  const sections = [DEBUG_SECTIONS.WORKBENCH, DEBUG_SECTIONS.PROJECT, DEBUG_SECTIONS.RUNTIME]

  return function DebugWorkspace(props) {
    const el = React.createElement
    const sessionId = props?.sessionId || ''
    const cwd = sessionCwd(props)
    const [section, setSection] = React.useState(() => initialSection(sessionId, cwd))
    openProjectRef.current = (target) => {
      const next = {
        viewId: VIEW_DEBUG,
        section: DEBUG_SECTIONS.PROJECT,
        target: target && typeof target === 'object' ? { file: target.file || '', line: target.line || 0 } : {},
      }
      setSection(DEBUG_SECTIONS.PROJECT)
      navigate(sessionId, cwd, next, { source: 'manual' })
    }
    React.useEffect(() => {
      setSection(initialSection(sessionId, cwd))
      return subscribeNav(sessionId, cwd, (nav) => {
        if (nav && nav.viewId === VIEW_DEBUG && isDebugSection(nav.section)) setSection(nav.section)
      })
    }, [sessionId, cwd])
    return el(
      'div',
      { className: 'dvb-workspace', 'data-workspace': 'debug', 'data-section': section },
      renderWorkspaceTabs(el, {
        sections,
        active: section,
        labels,
        onSelect(id) {
          setSection(id)
          navigate(sessionId, cwd, { viewId: VIEW_DEBUG, section: id }, { source: 'manual' })
        },
      }),
      el(
        'div',
        { className: 'dvb-ws-body' },
        section === DEBUG_SECTIONS.WORKBENCH
          ? el(WorkbenchPage, props)
          : section === DEBUG_SECTIONS.PROJECT
            ? el(ProjectPage, props)
            : el(RuntimePage, props),
      ),
    )
  }
}
