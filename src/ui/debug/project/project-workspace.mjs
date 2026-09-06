// 工程结构 — 树形/图谱双视图 + 左右分栏（导航 + 源码预览）。
import { formatErrorMessage, subscribeState } from '../../../../bench-shared.mjs'
import { beginRequest, postWithAbort, shouldApplyRequest } from '../../common/latest-request-gate.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { getCustomSelect } from '../../components/custom-select.mjs'
import { createSourceEditor } from '../../components/source-editor.mjs'
import { getNav, subscribeNav } from '../../workspace/vision-navigation-store.mjs'
import { DEBUG_SECTIONS, VIEW_DEBUG } from '../../workspace/vision-route.mjs'
import { buildProjectGraph } from './project-graph-model.mjs'
import { createProjectGraphView } from './project-graph-view.mjs'
import { createProjectPreviewPanel } from './project-preview-panel.mjs'
import {
  emptyPreviewState,
  loadProjectViewMode,
  matchesIdentity,
  projectIdentityKey,
  saveProjectViewMode,
  tagMappedState,
} from './project-shared.mjs'
import {
  buildProjectTree,
  fileTreeId,
  findFileByTreeId,
  findProjectFile,
  jumpErrorForHit,
} from './project-tree-model.mjs'
import { createProjectTreePanel } from './project-tree-panel.mjs'

export function shouldIgnoreProjectSearchShortcut(ev) {
  if (!ev || ev.key !== '/') return true
  if (ev.defaultPrevented) return true
  const target = ev.target
  if (!target) return false
  if (target.isContentEditable) return true
  if (typeof target.closest === 'function') {
    if (target.closest('[contenteditable="true"]')) return true
    if (target.closest('[role="textbox"]')) return true
    if (target.closest('[role="dialog"]')) return true
    if (target.closest('.cm-editor')) return true
  }
  const tag = String(target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true
  const role = target.getAttribute ? target.getAttribute('role') : ''
  if (role === 'textbox' || role === 'dialog') return true
  return false
}

const NO_EDGES = Object.freeze([])

/** Abort the controller held in `ref` (if any) and clear the slot. */
function abortRef(ref) {
  const ac = ref.current
  ref.current = null
  if (ac) ac.abort()
}

/** Replace the controller held in `ref`, aborting the previous same-kind request first. */
function swapAbortController(ref) {
  abortRef(ref)
  const ac = new AbortController()
  ref.current = ac
  return ac
}

/** Drop the slot only if it still points at `ac` (a newer request may already own it). */
function releaseAbortController(ref, ac) {
  if (ref.current === ac) ref.current = null
}

export function createProjectWorkspace(React, t, post) {
  const CustomSelect = getCustomSelect(React)
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
    const mapRequestRef = React.useRef(0)
    const previewRequestRef = React.useRef(0)
    const mapAbortRef = React.useRef(null)
    const previewAbortRef = React.useRef(null)
    const mountedRef = React.useRef(true)
    const prevIdentityRef = React.useRef('')

    const identityKey = projectIdentityKey(sessionId, cwd, keil)
    // Live identity for async gates: callbacks must compare against the render-time
    // value, not the identityKey closed over when the request started.
    const identityRef = React.useRef(identityKey)
    identityRef.current = identityKey
    const activeMapped = matchesIdentity(mapped, identityKey) ? mapped : null
    mappedRef.current = activeMapped

    React.useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
        abortRef(mapAbortRef)
        abortRef(previewAbortRef)
      }
    }, [])

    React.useEffect(() => {
      if (prevIdentityRef.current === identityKey) return
      const prev = prevIdentityRef.current
      prevIdentityRef.current = identityKey
      const splitKey = (key) => {
        const parts = String(key || '').split('\0')
        return { sessionId: parts[0] || '', cwd: parts[1] || '', project: parts[2] || '', target: parts[3] || '' }
      }
      const was = splitKey(prev)
      const now = splitKey(identityKey)
      const workspaceChanged = was.sessionId !== now.sessionId || was.cwd !== now.cwd
      const keilChanged = was.project !== now.project || was.target !== now.target
      const keilHydrated = !was.project && !!now.project

      // Invalidate every in-flight request from the previous identity before the
      // map effect (declared later) starts the request for the new one.
      beginRequest(mapRequestRef)
      beginRequest(previewRequestRef)
      abortRef(mapAbortRef)
      abortRef(previewAbortRef)

      setMapped(null)
      setError('')
      setBusy(false)
      setPreview(null)
      setCopied('')
      setJumpLine(0)
      mappedRef.current = null

      if (workspaceChanged || (keilChanged && !keilHydrated)) {
        setSearch('')
        setFilter('all')
        setOpenGroups({})
        setOpenFiles({})
        setCfgOpen(false)
        setSelectedId('')
        pendingJumpRef.current = null
      }
    }, [identityKey])

    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return
        if (shouldIgnoreProjectSearchShortcut(ev)) return
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

    const applyMapResponse = React.useCallback(
      (data, reqIdentity) => {
        if (data && data.ok === false) {
          setMapped(null)
          setError(formatErrorMessage(data.error) || t('loadFail'))
          return
        }
        setError('')
        const details = data?.result?.details ? data.result.details : null
        setMapped(tagMappedState(details, reqIdentity))
        if (details) {
          const nextGroups = details.groups || []
          const next = {}
          for (const g of nextGroups) next[g.name] = true
          setOpenGroups(next)
        }
      },
      [t],
    )

    /**
     * Start (or restart) the map request for the current identity. Any earlier map
     * request is aborted so only the newest one may ever touch page state.
     * @returns {{ promise: Promise<void>, ac: AbortController } | null}
     */
    const startMapRequest = React.useCallback(() => {
      if (!cwd || !keil.project) return null
      const requestId = beginRequest(mapRequestRef)
      const reqIdentity = identityKey
      const ac = swapAbortController(mapAbortRef)
      const mayApply = () => shouldApplyRequest(mapRequestRef, requestId, reqIdentity, identityRef.current, mountedRef)
      setBusy(true)
      setError('')
      const promise = postWithAbort(
        post,
        '/dsh-vision-bench/keil/map',
        { cwd, project: keil.project, target: keil.target },
        ac.signal,
      )
        .then((data) => {
          if (!mayApply()) return
          applyMapResponse(data, reqIdentity)
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          if (!mayApply()) return
          setMapped(null)
          setError(String(err?.message || t('loadFail')))
        })
        .finally(() => {
          releaseAbortController(mapAbortRef, ac)
          if (mayApply()) setBusy(false)
        })
      return { promise, ac }
    }, [applyMapResponse, cwd, identityKey, keil.project, keil.target, post, t])

    const reloadMap = React.useCallback(() => {
      const started = startMapRequest()
      return started ? started.promise : Promise.resolve()
    }, [startMapRequest])

    React.useEffect(() => {
      const started = startMapRequest()
      if (!started) return undefined
      return () => {
        started.ac.abort()
        releaseAbortController(mapAbortRef, started.ac)
      }
    }, [startMapRequest])

    const counts = activeMapped?.counts ? activeMapped.counts : {}
    const groups = activeMapped && Array.isArray(activeMapped.groups) ? activeMapped.groups : []
    const truncated =
      activeMapped?.truncated && typeof activeMapped.truncated === 'object' ? activeMapped.truncated : {}
    const tree = buildProjectTree(groups, { filter, search })
    const includeEdges = Array.isArray(activeMapped?.include_edges) ? activeMapped.include_edges : NO_EDGES
    const backendTruncated = Boolean(truncated.include_edges)
    const graph = React.useMemo(
      () => buildProjectGraph(groups, includeEdges, { filter, search, backendTruncated }),
      [groups, includeEdges, filter, search, backendTruncated],
    )

    const selectedHit = selectedId ? findFileByTreeId(groups, selectedId) : null
    const focusLabel = selectedHit
      ? `${selectedHit.file.name || selectedId}${selectedHit.group?.name ? ` · ${selectedHit.group.name}` : ''}`
      : ''

    const openPreview = React.useCallback(
      (file, line = 0) => {
        const rel = file.rel || file.path || file.name
        const reqIdentity = identityKey
        const requestId = beginRequest(previewRequestRef)
        // Opening another file, changing identity or unmounting aborts this request;
        // the controller lives in previewAbortRef rather than being handed back to the caller.
        const ac = swapAbortController(previewAbortRef)
        const mayApply = () =>
          shouldApplyRequest(previewRequestRef, requestId, reqIdentity, identityRef.current, mountedRef)
        setJumpLine(Number(line) || 0)
        setPreview({ ...emptyPreviewState(rel, reqIdentity), loading: true, rel, identityKey: reqIdentity })
        postWithAbort(post, '/dsh-vision-bench/project/file', { cwd, path: rel }, ac.signal)
          .then((data) => {
            if (!mayApply()) return
            setPreview(
              data?.ok
                ? {
                    rel: data.rel,
                    text: data.text,
                    lines: data.lines,
                    truncated: !!data.truncated,
                    error: '',
                    identityKey: reqIdentity,
                    loading: false,
                  }
                : {
                    ...emptyPreviewState(rel, reqIdentity),
                    error: data?.error || '读取失败',
                  },
            )
          })
          .catch((err) => {
            if (err?.name === 'AbortError') return
            if (!mayApply()) return
            setPreview({
              ...emptyPreviewState(rel, reqIdentity),
              error: String(err?.message || '读取失败'),
            })
          })
          .finally(() => {
            releaseAbortController(previewAbortRef, ac)
          })
      },
      [cwd, identityKey, post],
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
      mappedRef.current = activeMapped
      applyJumpRef.current()
    }, [activeMapped])

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
      activeMapped &&
      (truncated.files || truncated.includes || truncated.defines || truncated.include_edges || truncated.functions)

    const navBody =
      viewMode === 'graph'
        ? graph.nodes.length || busy
          ? el(GraphView, {
              graph,
              selectedId,
              onSelect(node) {
                const hit = findFileByTreeId(groups, node.id)
                if (!hit) return
                selectFile({ ...hit.file, _group: hit.group.name })
              },
              onClearSelect() {
                setSelectedId('')
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
        activeMapped
          ? el(
              'span',
              { className: 'dvb-project-chip' },
              `${activeMapped.target || ''} · ${String(counts.files || 0)} 文件 · ${String(graph.edges.length)} 依赖`,
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
        el(CustomSelect, {
          style: { width: '100px', flex: 'none' },
          selectClassName: 'dvb-map-filter',
          value: filter,
          options: [
            { value: 'all', label: '全部' },
            { value: 'missing', label: '缺失' },
            { value: 'unread', label: '不可读' },
            { value: 'outside', label: '工作区外' },
          ],
          onChange(val) {
            const next = val?.target ? val.target.value : val
            setFilter(next)
          },
        }),
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
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, formatErrorMessage(error)) : null,
      truncatedBanner ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('mapTruncated')) : null,
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      el(
        'div',
        { className: 'dvb-project-split' },
        el('div', { className: 'dvb-project-nav' }, el('div', { className: 'dvb-project-nav-scroll' }, navBody)),
        el(PreviewPanel, {
          preview,
          identityKey,
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
