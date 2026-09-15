// 工程结构 — 树形/图谱双视图 + 左右分栏（导航 + 源码预览）。
import { formatErrorMessage } from '../../common/ui-format.mjs'
import { createSourceEditor } from '../../components/source-editor.mjs'
import { createFunctionDetailPanel } from './function-detail-panel.mjs'
import { createProjectGraphView } from './project-graph-view.mjs'
import { createProjectPreviewPanel } from './project-preview-panel.mjs'
import { createProjectToolbar } from './project-toolbar.mjs'
import {
  fileTreeId,
  findFileByTreeId,
  findProjectFile,
} from './project-tree-model.mjs'
import { createProjectTreePanel } from './project-tree-panel.mjs'
import { createUseProjectSession, shouldIgnoreProjectSearchShortcut } from './use-project-session.mjs'

export { shouldIgnoreProjectSearchShortcut }

export function createProjectWorkspace(React, t, post) {
  const SourceEditor = createSourceEditor(React)
  const TreePanel = createProjectTreePanel(React)
  const GraphView = createProjectGraphView(React)
  const PreviewPanel = createProjectPreviewPanel(React, t, SourceEditor)
  const FunctionDetailPanel = createFunctionDetailPanel(React, t)
  const Toolbar = createProjectToolbar(React)
  const useProjectSession = createUseProjectSession(React, t, post)

  return function ProjectWorkspace(props) {
    const el = React.createElement
    const s = useProjectSession(props)

    const navBody =
      s.viewMode === 'graph'
        ? s.graph.nodes.length || s.busy
          ? el(GraphView, {
              graph: s.graph,
              selectedId: s.effectiveRelType === 'call' ? s.activeFuncId : s.selectedId,
              onSelect(node) {
                if (s.effectiveRelType === 'call') {
                  s.setSelectedId(node.id)
                  return
                }
                const hit = findFileByTreeId(s.groups, node.id)
                if (!hit) return
                s.selectFile({ ...hit.file, _group: hit.group.name })
              },
              onClearSelect() {
                s.setSelectedId('__none__')
              },
            })
          : el('div', { className: 'dvb-hint' }, '暂无依赖图谱可显示。请确认工程含 #include 依赖或放宽筛选。')
        : s.tree.length
          ? el(TreePanel, {
              props,
              tree: s.tree,
              openGroups: s.openGroups,
              setOpenGroups: s.setOpenGroups,
              openFiles: s.openFiles,
              setOpenFiles: s.setOpenFiles,
              selectedId: s.selectedId,
              setSelectedId: s.setSelectedId,
              jumpLine: s.jumpLine,
              projectName: s.isDemo ? 'TemperatureDemo' : s.activeMapped?.project?.replace(/\.uvprojx$/i, '') || '',
              onPreview: (file, line) => {
                s.setSelectedId(fileTreeId(file))
                s.openPreview(file, line)
              },
              onCopyPath: s.flashCopied,
              onCopied: s.flashCopied,
            })
          : s.busy
            ? el('div', { className: 'dvb-hint' }, t('opening'))
            : el('div', { className: 'dvb-hint' }, '暂无文件，请检查工程或筛选条件。')

    return el(
      'div',
      { className: 'dvb-live dvb-map dvb-project' },
      el(Toolbar, {
        viewMode: s.viewMode,
        onViewMode: s.setNavView,
        search: s.search,
        onSearch: s.setSearch,
        searchRef: s.searchRef,
        filter: s.filter,
        onFilter: s.setFilter,
        effectiveRelType: s.effectiveRelType,
        onRelType: s.setUserRelType,
        graphDepth: s.graphDepth,
        onGraphDepth: s.setGraphDepth,
        keil: s.keil,
        isDemo: s.isDemo,
        busy: s.busy,
        onReload: s.reloadMap,
        t,
        activeMapped: s.activeMapped,
        counts: s.counts,
        graph: s.graph,
        focusLabel: s.focusLabel,
      }),
      !s.cwd
        ? el('div', { className: 'dvb-hint' }, t('needWorkspace'))
        : !s.keil.project && !s.isDemo
          ? el('div', { className: 'dvb-hint' }, t('projectMapEmpty'))
          : null,
      s.error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, formatErrorMessage(s.error)) : null,
      s.truncatedBanner ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('mapTruncated')) : null,
      s.copied ? el('div', { className: 'dvb-hint' }, s.copied) : null,
      el(
        'div',
        { className: `dvb-project-split${s.viewMode === 'graph' ? ' is-graph-mode' : ''}` },
        el('div', { className: 'dvb-project-nav' }, el('div', { className: 'dvb-project-nav-scroll' }, navBody)),
        s.viewMode === 'graph' && s.selectedFuncNode
          ? el(FunctionDetailPanel, {
              funcNode: s.selectedFuncNode,
              onClose: () => s.setSelectedId('__none__'),
              onSelectNode: (nid) => s.setSelectedId(String(nid || '').startsWith('fn:') ? nid : `fn:${nid}`),
              onExpandNextLevel: () => s.setGraphDepth('3'),
              onLocateSource: (fileName, line) => {
                s.setNavView('tree')
                const hit = findProjectFile(s.groups, fileName)
                s.selectFile(hit ? hit.file : { name: fileName, rel: fileName, path: fileName }, line)
              },
            })
          : el(PreviewPanel, {
              preview: s.preview,
              identityKey: s.identityKey,
              jumpLine: s.jumpLine,
              mapped: s.activeMapped,
              counts: s.counts,
              cfgOpen: s.cfgOpen,
              onToggleCfg: () => s.setCfgOpen((v) => !v),
              onJumpLine: (line) => s.setJumpLine(line),
              selectedFile: s.selectedHit?.file || null,
              selectedGroup: s.selectedHit?.group?.name || '',
              onClose: () => {
                s.setPreview(null)
                s.setJumpLine(0)
              },
              isDemo: s.isDemo,
            }),
      ),
    )
  }
}
