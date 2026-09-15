import { formatErrorMessage } from '../../common/ui-format.mjs'
import { subscribeState } from '../../common/state-subscription.mjs'
import { beginRequest, postWithAbort, shouldApplyRequest } from '../../common/latest-request-gate.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { getNav, subscribeNav } from '../../workspace/vision-navigation-store.mjs'
import { DEBUG_SECTIONS, VIEW_DEBUG } from '../../workspace/vision-route.mjs'
import { DEMO_PROJECT_MAP, demoFileText } from '../fixtures/temperature-demo.mjs'
import { buildFunctionCallGraph, buildProjectGraph } from './project-graph-model.mjs'
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

const NO_EDGES = Object.freeze([])

function abortRef(ref) {
  const ac = ref.current
  ref.current = null
  ac?.abort()
}

function swapAbortController(ref) {
  abortRef(ref)
  return (ref.current = new AbortController())
}

function releaseAbortController(ref, ac) {
  if (ref.current === ac) ref.current = null
}

export function shouldIgnoreProjectSearchShortcut(ev) {
  if (!ev || ev.key !== '/' || ev.defaultPrevented) return true
  const t = ev.target
  if (!t || t.isContentEditable) return !!t
  if (typeof t.closest === 'function' && t.closest('[contenteditable="true"],[role="textbox"],[role="dialog"],.cm-editor')) return true
  const tag = String(t.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true
  const role = t.getAttribute ? t.getAttribute('role') : ''
  return role === 'textbox' || role === 'dialog'
}

/**
 * Session, map, preview and selection for the project structure page.
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 */
export function createUseProjectSession(React, t, post) {
  return function useProjectSession(props) {
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const [keil, setKeil] = React.useState({ project: '', target: '' })
    const [mapped, setMapped] = React.useState(null)
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [search, setSearch] = React.useState('')
    const [filter, setFilter] = React.useState('all')
    const [userRelType, setUserRelType] = React.useState(null)
    const [graphDepth, setGraphDepth] = React.useState('2')
    const [viewMode, setViewMode] = React.useState(() => loadProjectViewMode(sessionId, cwd, 'tree'))
    const [openGroups, setOpenGroups] = React.useState({})
    const [openFiles, setOpenFiles] = React.useState({})
    const [cfgOpen, setCfgOpen] = React.useState(false)
    const [preview, setPreview] = React.useState(null)
    const [copied, setCopied] = React.useState('')
    const flashCopied = React.useCallback((msg) => {
      setCopied(msg)
      setTimeout(() => setCopied(''), 2000)
    }, [])
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
    const identityRef = React.useRef(identityKey)
    identityRef.current = identityKey
    const isTestEnv = typeof navigator !== 'undefined' && String(navigator.userAgent || '').includes('happy')
    const [demoActive] = React.useState(() => {
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          const v = window.sessionStorage.getItem('dvb:demo_project')
          if (v !== null) return v === 'true'
        }
      } catch {}
      return !isTestEnv
    })
    const isDemo = Boolean(demoActive && !keil.project)
    const activeMapped = isDemo ? DEMO_PROJECT_MAP : matchesIdentity(mapped, identityKey) ? mapped : null
    mappedRef.current = activeMapped

    React.useEffect(() => {
      if (isDemo && (!preview || preview.rel !== 'sensor.c')) {
        const code = demoFileText('sensor.c')
        setPreview({
          rel: 'sensor.c',
          text: code,
          lines: code.split('\n').length,
          truncated: false,
          error: '',
          identityKey,
          isDemo: true,
          loading: false,
        })
        setJumpLine(6)
        setSelectedId('sensor.c')
        setOpenGroups({ 'Source Group1': true, Headers: true, Startup: false, Libraries: false })
      }
    }, [isDemo, preview, identityKey])

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
      const [wS, wC, wP, wT] = String(prev || '').split('\0')
      const [nS, nC, nP, nT] = String(identityKey || '').split('\0')
      const workspaceChanged = wS !== nS || wC !== nC
      const keilChanged = wP !== nP || wT !== nT
      const keilHydrated = !wP && !!nP

      beginRequest(mapRequestRef)
      beginRequest(previewRequestRef)
      abortRef(mapAbortRef)
      abortRef(previewAbortRef)

      setMapped(null)
      setError('')
      setBusy(false)
      if (!isDemo) setPreview(null)
      setCopied('')
      setJumpLine(0)
      mappedRef.current = null

      if (workspaceChanged || (keilChanged && !keilHydrated)) {
        setSearch('')
        setFilter('all')
        setOpenGroups({})
        setOpenFiles({})
        setCfgOpen(false)
        if (!isDemo) setSelectedId('')
        pendingJumpRef.current = null
      }
    }, [identityKey, isDemo])

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
      if (isDemo) {
        setSearch('')
        setFilter('all')
        setGraphDepth('2')
        return Promise.resolve()
      }
      const started = startMapRequest()
      return started ? started.promise : Promise.resolve()
    }, [isDemo, startMapRequest])

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

    const effectiveRelType =
      userRelType != null
        ? userRelType
        : isDemo
          ? 'call'
          : includeEdges.length > 0 && !activeMapped?.calls?.length
            ? 'include'
            : 'call'

    const fileGraph = React.useMemo(
      () => buildProjectGraph(groups, includeEdges, { filter, search, backendTruncated }),
      [groups, includeEdges, filter, search, backendTruncated],
    )
    const callGraph = React.useMemo(
      () => buildFunctionCallGraph(groups, { search, depth: graphDepth }),
      [groups, search, graphDepth],
    )
    const graph = effectiveRelType === 'call' ? callGraph : fileGraph

    const defaultCallId =
      callGraph.nodes.find((n) => n.id === `fn:${callGraph.focus}` || n.name === callGraph.focus)?.id ||
      callGraph.nodes[0]?.id ||
      ''
    const activeFuncId =
      effectiveRelType !== 'call'
        ? ''
        : selectedId && String(selectedId).startsWith('fn:')
          ? selectedId
          : selectedId === '__none__'
            ? ''
            : defaultCallId
    const selectedFuncNode =
      effectiveRelType === 'call' && activeFuncId
        ? callGraph.nodes.find((n) => n.id === activeFuncId) || callGraph.nodes.find((n) => n.id === defaultCallId) || null
        : null
    const selectedHit =
      (selectedId ? findFileByTreeId(groups, selectedId) : null) ||
      (preview?.rel ? findProjectFile(groups, preview.rel) : null)
    const focusLabel = selectedHit
      ? `${selectedHit.file.name || selectedId}${selectedHit.group?.name ? ` · ${selectedHit.group.name}` : ''}`
      : ''

    const openPreview = React.useCallback(
      (file, line = 0) => {
        const rel = file.rel || file.path || file.name
        const reqIdentity = identityKey
        const demoCode = demoFileText(file?.name) || demoFileText(rel)
        if (isDemo && demoCode) {
          setJumpLine(Number(line) || 0)
          setPreview({
            rel,
            text: demoCode,
            lines: demoCode.split('\n').length,
            truncated: false,
            error: '',
            identityKey: reqIdentity,
            loading: false,
          })
          return
        }
        const requestId = beginRequest(previewRequestRef)
        const ac = swapAbortController(previewAbortRef)
        const mayApply = () =>
          shouldApplyRequest(previewRequestRef, requestId, reqIdentity, identityRef.current, mountedRef)
        setJumpLine(Number(line) || 0)
        setPreview({ ...emptyPreviewState(rel, reqIdentity), loading: true, rel, identityKey: reqIdentity })
        postWithAbort(post, '/dsh-vision-bench/project/file', { cwd, path: rel }, ac.signal)
          .then((data) => {
            if (!mayApply()) return
            if (data?.ok) {
              setPreview({
                rel: data.rel,
                text: data.text,
                lines: data.lines,
                truncated: !!data.truncated,
                error: '',
                identityKey: reqIdentity,
                loading: false,
              })
            } else {
              setPreview({ ...emptyPreviewState(rel, reqIdentity), error: data?.error || '读取失败' })
            }
          })
          .catch((err) => {
            if (err?.name !== 'AbortError' && mayApply()) {
              setPreview({ ...emptyPreviewState(rel, reqIdentity), error: String(err?.message || '读取失败') })
            }
          })
          .finally(() => {
            releaseAbortController(previewAbortRef, ac)
          })
      },
      [cwd, identityKey, isDemo, post],
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

    return {
      cwd,
      sessionId,
      keil,
      isDemo,
      identityKey,
      error,
      busy,
      copied,
      flashCopied,
      search,
      setSearch,
      searchRef,
      filter,
      setFilter,
      viewMode,
      setNavView,
      setUserRelType,
      graphDepth,
      setGraphDepth,
      openGroups,
      setOpenGroups,
      openFiles,
      setOpenFiles,
      cfgOpen,
      setCfgOpen,
      preview,
      setPreview,
      jumpLine,
      setJumpLine,
      selectedId,
      setSelectedId,
      activeMapped,
      counts,
      groups,
      tree,
      graph,
      effectiveRelType,
      selectedFuncNode,
      activeFuncId,
      selectedHit,
      focusLabel,
      truncatedBanner,
      reloadMap,
      selectFile,
      openPreview,
    }
  }
}
