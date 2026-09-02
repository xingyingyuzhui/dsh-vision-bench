// 工程结构 — 树形/图谱双视图 + 左右分栏（导航 + 源码预览）。
import { subscribeState } from '../../../../bench-shared.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createSourceEditor } from '../../components/source-editor.mjs'
import { getNav, subscribeNav } from '../../workspace/vision-navigation-store.mjs'
import { DEBUG_SECTIONS, VIEW_DEBUG } from '../../workspace/vision-route.mjs'
import { createProjectGraphView } from './project-graph-view.mjs'
import { buildProjectGraph } from './project-graph-model.mjs'
import { createProjectPreviewPanel } from './project-preview-panel.mjs'
import {
  emptyPreviewState,
  loadProjectViewMode,
  saveProjectViewMode,
} from './project-shared.mjs'
import { createProjectTreePanel } from './project-tree-panel.mjs'
import {
  buildProjectTree,
  fileTreeId,
  findFileByTreeId,
  findProjectFile,
  jumpErrorForHit,
} from './project-tree-model.mjs'

export function createProjectWorkspace(React, t, post) {
  const SourceEditor = createSourceEditor(React)
  const TreePanel = createProjectTreePanel(React)
  const GraphView = createProjectGraphView(React)
  const PreviewPanel = createProjectPreviewPanel(React, t, SourceEditor)

  return function ProjectWorkspace(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const [keil, setKeil] = React.useState({ project: '', target: '' })
    const [mapped, setMapped] = React.useState(null)
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [search, setSearch] = React.useState('')
    const [filter, setFilter] = React.useState('all')
    const [viewMode, setViewMode] = React.useState(() => loadProjectViewMode(sessionId, cwd))
    const [openGroups, setOpenGroups] = React.useState({})
    const [openFiles, setOpenFiles] = React.useState({})
    const [cfgOpen, setCfgOpen] = React.useState(false)
    const [preview, setPreview] = React.useState(null)
    const [copied, setCopied] = React.useState('')
    const [jumpLine, setJumpLine] = React.useState(0)
    const [selectedId, setSelectedId] = React.useState('')
    const pendingJumpRef = React.useRef(null)
    const mappedRef = React.useRef(null)
    const applyJumpRef = React.useRef(() => {})
    const searchRef = React.useRef(null)
    mappedRef.current = mapped

    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return
        const tag = String(ev.target?.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return
        ev.preventDefault()
        searchRef.current?.focus()
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [])

    React.useEffect(() => {
      setViewMode(loadProjectViewMode(sessionId, cwd))
    }, [sessionId, cwd])

    const setNavView = (mode) => {
      const next = mode === 'graph' ? 'graph' : 'tree'
      setViewMode(next)
      saveProjectViewMode(sessionId, cwd, next)
    }

    React.useEffect(() => {
      if (!cwd) {
        setKeil({ project: '', target: '' })
        setMapped(null)
        return undefined
      }
      return subscribeState(
        post,
        cwd,
        (data) => {
          if (!data || data.ok === false) return
          const next = data.workspace?.keil ? data.workspace.keil : {}
          const project = next.project || ''
          const target = next.target || ''
          setKeil((prev) => (prev.project === project && prev.target === target ? prev : { project, target }))
        },
        { sessionId },
      )
    }, [cwd, post, sessionId, props?.scope?.sessionId])

    const reloadMap = React.useCallback(() => {
      if (!cwd || !keil.project) return Promise.resolve()
      setBusy(true)
      setError('')
      return post('/dsh-vision-bench/keil/map', { cwd, project: keil.project, target: keil.target })
        .then((data) => {
          if (data && data.ok === false) {
            setMapped(null)
            setError(data.error || t('loadFail'))
            return
          }
          setError('')
          setMapped(data?.result?.details ? data.result.details : null)
          if (data?.result?.details) {
            const nextGroups = data.result.details.groups || []
            const next = {}
            for (const g of nextGroups) next[g.name] = true
            setOpenGroups(next)
          }
        })
        .catch((err) => {
          setMapped(null)
          setError(String(err?.message || t('loadFail')))
        })
        .finally(() => setBusy(false))
    }, [cwd, keil.project, keil.target, post, t])

    React.useEffect(() => {
      let stop = false
      if (!cwd || !keil.project) {
        setMapped(null)
        return undefined
      }
      setBusy(true)
      setError('')
      post('/dsh-vision-bench/keil/map', { cwd, project: keil.project, target: keil.target })
        .then((data) => {
          if (stop) return
          if (data && data.ok === false) {
            setMapped(null)
            setError(data.error || t('loadFail'))
            return
          }
          setError('')
          setMapped(data?.result?.details ? data.result.details : null)
          if (data?.result?.details) {
            const nextGroups = data.result.details.groups || []
            const next = {}
            for (const g of nextGroups) next[g.name] = true
            setOpenGroups(next)
          }
        })
        .catch((err) => {
          if (!stop) {
            setMapped(null)
            setError(String(err?.message || t('loadFail')))
          }
        })
        .finally(() => {
          if (!stop) setBusy(false)
        })
      return () => {
        stop = true
      }
    }, [cwd, keil.project, keil.target, post, t])

    const counts = mapped?.counts ? mapped.counts : {}
    const groups = mapped && Array.isArray(mapped.groups) ? mapped.groups : []
    const truncated = mapped?.truncated && typeof mapped.truncated === 'object' ? mapped.truncated : {}
    const tree = buildProjectTree(groups, { filter, search })
    const graph = React.useMemo(
      () => buildProjectGraph(groups, mapped?.include_edges || [], { filter, search }),
      [groups, mapped?.include_edges, filter, search],
    )

    const selectedHit = selectedId ? findFileByTreeId(groups, selectedId) : null
    const focusLabel = selectedHit
      ? `${selectedHit.file.name || selectedId}${selectedHit.group?.name ? ` · ${selectedHit.group.name}` : ''}`
      : ''

    const openPreview = React.useCallback(
      (file, line = 0) => {
        const rel = file.rel || file.path || file.name
        setJumpLine(Number(line) || 0)
        setPreview({ ...emptyPreviewState(rel), loading: true, rel })
        post('/dsh-vision-bench/project/file', { cwd, path: rel })
          .then((data) => {
            setPreview(
              data?.ok
                ? { rel: data.rel, text: data.text, lines: data.lines, truncated: !!data.truncated, error: '' }
                : {
                    ...emptyPreviewState(rel),
                    error: data?.error || '读取失败',
                  },
            )
          })
          .catch((err) =>
            setPreview({
              ...emptyPreviewState(rel),
              error: String(err?.message || '读取失败'),
            }),
          )
      },
      [cwd, post],
    )

    const selectFile = (file, line = 0) => {
      const fid = fileTreeId(file)
      setSelectedId(fid)
      setOpenFiles((prev) => ({ ...prev, [fid]: true }))
      if (file._group || selectedHit?.group?.name) {
        const gName = file._group || selectedHit?.group?.name
        if (gName) setOpenGroups((prev) => ({ ...prev, [gName]: true }))
      }
      openPreview(file, line)
    }

    const applyPendingJump = () => {
      const jump = pendingJumpRef.current
      const jumpGroups = mappedRef.current?.groups
      if (!jump || !jumpGroups) return
      const hit = findProjectFile(jumpGroups, jump.file)
      const fail = jumpErrorForHit(hit, jump.file)
      if (fail) {
        pendingJumpRef.current = null
        setError(fail)
        return
      }
      pendingJumpRef.current = null
      setError('')
      setNavView('tree')
      setOpenGroups((prev) => ({ ...prev, [hit.group.name]: true }))
      const fid = fileTreeId(hit.file)
      setOpenFiles((prev) => ({ ...prev, [fid]: true }))
      setSelectedId(fid)
      openPreview(hit.file, jump.line)
    }
    applyJumpRef.current = applyPendingJump

    React.useEffect(() => {
      mappedRef.current = mapped
      applyJumpRef.current()
    }, [mapped])

    React.useEffect(() => {
      const take = (nav) => {
        const file = nav?.target?.file
        if (nav?.viewId === VIEW_DEBUG && nav.section === DEBUG_SECTIONS.PROJECT && file) {
          pendingJumpRef.current = { file: String(file), line: Number(nav.target.line) || 0 }
          applyJumpRef.current()
        }
      }
      take(getNav(sessionId, cwd))
      return subscribeNav(sessionId, cwd, take)
    }, [cwd, sessionId, props?.sessionId, props?.scope?.sessionId])

    const truncatedBanner =
      mapped &&
      (truncated.files || truncated.includes || truncated.defines || truncated.include_edges || truncated.functions)

    const navBody =
      viewMode === 'graph'
        ? graph.nodes.length || busy
          ? el(GraphView, {
              graph,
              selectedId,
              capped: graph.capped,
              edgesCapped: graph.edgesCapped,
              orphanEdges: graph.orphanEdges,
              truncatedIncludeEdges: !!truncated.include_edges,
              onSelect(node) {
                const hit = findFileByTreeId(groups, node.id)
                if (!hit) return
                selectFile({ ...hit.file, _group: hit.group.name })
              },
            })
          : el('div', { className: 'dvb-hint' }, '暂无依赖图谱可显示。请确认工程含 #include 依赖或放宽筛选。')
        : tree.length
          ? el(TreePanel, {
              props,
              tree,
              openGroups,
              setOpenGroups,
              openFiles,
              setOpenFiles,
              selectedId,
              setSelectedId,
              jumpLine,
              onPreview: (file, line) => {
                setSelectedId(fileTreeId(file))
                openPreview(file, line)
              },
              onCopyPath: (line) => {
                setCopied(line)
                setTimeout(() => setCopied(''), 2000)
              },
              onCopied: (msg) => {
                setCopied(msg)
                setTimeout(() => setCopied(''), 2000)
              },
            })
          : busy
            ? el('div', { className: 'dvb-hint' }, t('opening'))
            : el('div', { className: 'dvb-hint' }, '暂无文件，请检查工程或筛选条件。')

    return el(
      'div',
      { className: 'dvb-live dvb-map dvb-project' },
      el(
        'div',
        { className: 'dvb-project-head' },
        el('span', { className: 'dvb-live-title' }, t('projectMap')),
        el(
          'div',
          { className: 'dvb-project-view-toggle' },
          el(
            'button',
            {
              type: 'button',
              className: `dvb-btn dvb-btn-sm${viewMode === 'tree' ? ' is-on' : ''}`,
              onClick() {
                setNavView('tree')
              },
            },
            '树形',
          ),
          el(
            'button',
            {
              type: 'button',
              className: `dvb-btn dvb-btn-sm${viewMode === 'graph' ? ' is-on' : ''}`,
              onClick() {
                setNavView('graph')
              },
            },
            '图谱',
          ),
        ),
        mapped
          ? el(
              'span',
              { className: 'dvb-project-chip' },
              `${mapped.target || ''} · ${String(counts.files || 0)} 文件 · ${String(graph.edges.length)} 依赖`,
            )
          : null,
        focusLabel ? el('span', { className: 'dvb-project-focus-chip', title: focusLabel }, focusLabel) : null,
        el('input', {
          ref: searchRef,
          className: 'dvb-input dvb-map-search',
          placeholder: '搜索文件或函数…（/）',
          value: search,
          onChange: (event) => setSearch(event.target.value),
        }),
        el(
          'select',
          {
            className: 'dvb-input dvb-map-filter',
            value: filter,
            onChange: (event) => setFilter(event.target.value),
          },
          el('option', { value: 'all' }, '全部'),
          el('option', { value: 'missing' }, '缺失'),
          el('option', { value: 'unread' }, '不可读'),
          el('option', { value: 'outside' }, '工作区外'),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm',
            disabled: !keil.project || busy,
            onClick() {
              reloadMap()
            },
          },
          busy ? t('opening') : '重新加载',
        ),
      ),
      !cwd
        ? el('div', { className: 'dvb-hint' }, t('needWorkspace'))
        : !keil.project
          ? el('div', { className: 'dvb-hint' }, t('projectMapEmpty'))
          : null,
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      truncatedBanner ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('mapTruncated')) : null,
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      el(
        'div',
        { className: 'dvb-project-split' },
        el(
          'div',
          { className: 'dvb-project-nav' },
          el('div', { className: 'dvb-project-nav-scroll' }, navBody),
        ),
        el(PreviewPanel, {
          preview,
          jumpLine,
          mapped,
          counts,
          cfgOpen,
          onToggleCfg: () => setCfgOpen((v) => !v),
          onClose: () => {
            setPreview(null)
            setJumpLine(0)
          },
        }),
      ),
    )
  }
}
