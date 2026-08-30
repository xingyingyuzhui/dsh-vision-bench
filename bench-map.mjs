// Task5/0.19.3: 工程结构 — 组/文件/函数三级展开折叠 + 搜索 + 筛选
// (缺失/不可读/工作区外) + 文件操作（预览源码/复制路径/让Agent分析/Include 关系）+
// 可折叠的 编译配置（Include 路径、宏、依赖边）。侧栏「工程」→「工程结构」。
import { agentRefToText, buildAgentRef, copyAgentRef, hasHarnessInput, subscribeState } from './bench-shared.mjs'
import { sessionCwd } from './src/ui/common/session-scope.mjs'

export const TAB_MAP = 'dsh-vision-bench:project'

export function createMapView(React, t, post) {
  return function MapView(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const [keil, setKeil] = React.useState({ project: '', target: '' })
    const [mapped, setMapped] = React.useState(null)
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [search, setSearch] = React.useState('')
    const [filter, setFilter] = React.useState('all') // all | missing | unread | outside
    const [openGroups, setOpenGroups] = React.useState({})
    const [openFiles, setOpenFiles] = React.useState({})
    const [cfgOpen, setCfgOpen] = React.useState(false)
    const [preview, setPreview] = React.useState(null) // {rel, text, lines, truncated, error}
    const [copied, setCopied] = React.useState('')
    const [jumpLine, setJumpLine] = React.useState(0)

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
          const next = data.workspace && data.workspace.keil ? data.workspace.keil : {}
          const project = next.project || ''
          const target = next.target || ''
          // Task5/0.19.3: 编译错误定位 — 调试页点击错误后写入 jump 目标
          const jump = data.workspace && data.workspace.jumpProject
          if (jump && jump.file) {
            setJumpLine(Number(jump.line) || 0)
            setOpenFiles((prev) => ({ ...prev, [jump.file]: true }))
            try {
              setTargetJump(jump)
            } catch {}
          }
          setKeil((prev) => (prev.project === project && prev.target === target ? prev : { project, target }))
        },
        { sessionId: (props && props.sessionId) || '' },
      )
    }, [cwd, post, props && props.sessionId])

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
          setMapped(data && data.result && data.result.details ? data.result.details : null)
          if (data && data.result && data.result.details) {
            // 默认展开全部组
            const groups = data.result.details.groups || []
            const next = {}
            for (const g of groups) next[g.name] = true
            setOpenGroups(next)
          }
        })
        .catch((err) => {
          if (!stop) {
            setMapped(null)
            setError(String((err && err.message) || t('loadFail')))
          }
        })
        .finally(() => {
          if (!stop) setBusy(false)
        })
      return () => {
        stop = true
      }
    }, [cwd, keil.project, keil.target])

    const counts = mapped && mapped.counts ? mapped.counts : {}
    const groups = mapped && Array.isArray(mapped.groups) ? mapped.groups : []
    const truncated = mapped && mapped.truncated && typeof mapped.truncated === 'object' ? mapped.truncated : {}

    const fileKind = (file) => (!file.inside ? 'outside' : !file.exists ? 'missing' : !file.readable ? 'unread' : 'ok')

    const passesFilter = (file) => {
      if (filter === 'all') return true
      if (filter === 'missing') return !file.exists
      if (filter === 'unread') return file.exists && !file.readable
      if (filter === 'outside') return !file.inside
      return true
    }

    const openPreview = (file) => {
      setPreview({
        loading: true,
        rel: file.rel || file.path || file.name,
        text: '',
        lines: 0,
        truncated: false,
        error: '',
      })
      post('/dsh-vision-bench/project/file', { cwd, path: file.rel || file.path || file.name })
        .then((data) => {
          setPreview(
            data && data.ok
              ? { rel: data.rel, text: data.text, lines: data.lines, truncated: !!data.truncated, error: '' }
              : {
                  loading: false,
                  rel: file.name,
                  text: '',
                  lines: 0,
                  truncated: false,
                  error: (data && data.error) || '读取失败',
                },
          )
        })
        .catch((err) =>
          setPreview({
            loading: false,
            rel: file.name,
            text: '',
            lines: 0,
            truncated: false,
            error: String((err && err.message) || '读取失败'),
          }),
        )
    }

    const copyRel = (file) => {
      const line = file.rel || file.path || file.name
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
          navigator.clipboard.writeText(line)
      } catch {}
      setCopied(line)
      setTimeout(() => setCopied(''), 2000)
    }

    const copyToAgent = (file) => {
      const ref = buildAgentRef('file', {
        file: file.rel || file.path || file.name,
        group: file._group || '',
        functions: (file.functions || []).slice(0, 20).map((fn) => fn.name),
      })
      copyAgentRef(ref, () => setCopied('已复制文件引用'))
    }

    const fileRow = (file, groupName) => {
      const kind = fileKind(file)
      const isOpen = !!openFiles[file.rel || file.path || file.name]
      const jumpHere = jumpLine > 0
      return el(
        'div',
        { key: 'f' + (file.rel || file.path || file.name), className: 'dvb-map-file-row', 'data-kind': kind },
        el(
          'div',
          { className: 'dvb-map-file', 'data-kind': kind, title: file.rel || file.name },
          file.functions && file.functions.length
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-sm dvb-map-toggle',
                  onClick() {
                    const key = file.rel || file.path || file.name
                    setOpenFiles((prev) => ({ ...prev, [key]: !prev[key] }))
                  },
                },
                isOpen ? '▾' : '▸',
              )
            : el('span', { className: 'dvb-map-toggle dvb-map-toggle-void' }, '·'),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm dvb-map-file-name' + (jumpHere ? ' dvb-map-jump' : ''),
              title: '预览源码',
              onClick() {
                openPreview(file)
              },
            },
            file.name,
          ),
          el('span', { className: 'dvb-map-meta' }, file.rel || ''),
          el(
            'span',
            { className: 'dvb-map-file-mark' },
            kind === 'outside' ? '工作区外' : kind === 'missing' ? '缺失' : kind === 'unread' ? '不可读' : '',
          ),
        ),
        el(
          'div',
          { className: 'dvb-actions dvb-map-file-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              onClick() {
                openPreview(file)
              },
            },
            '预览',
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              onClick() {
                copyRel(file)
              },
            },
            '复制路径',
          ),
          hasHarnessInput
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-sm',
                  onClick() {
                    copyToAgent(file)
                  },
                },
                '让 Agent 分析',
              )
            : null,
          file._includes && file._includes.length
            ? el('span', { className: 'dvb-hint' }, 'Include ' + file._includes.length)
            : null,
        ),
        isOpen && file.functions && file.functions.length
          ? el(
              'div',
              { className: 'dvb-map-funcs' },
              file.functions.map((fn) =>
                el(
                  'div',
                  {
                    key: fn.name + ':' + fn.line,
                    className: 'dvb-map-func',
                    'data-jump': jumpHere && fn.line === jumpLine ? 'true' : '',
                  },
                  el('span', { className: 'dvb-map-func-name' }, fn.name),
                  el('span', { className: 'dvb-map-meta' }, 'line ' + (fn.line || '?')),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm',
                      title: '打开文件并定位到函数行',
                      onClick() {
                        openPreview(file)
                        setJumpLine(fn.line || 0)
                      },
                    },
                    '定位',
                  ),
                ),
              ),
            )
          : null,
      )
    }

    return el(
      'div',
      { className: 'dvb-live dvb-map' },
      el(
        'div',
        { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('projectMap')),
        mapped
          ? el(
              'span',
              { className: 'dvb-map-meta' },
              (mapped.target || '') + ' · ' + String(counts.files || 0) + ' 文件',
            )
          : null,
        el('input', {
          className: 'dvb-input dvb-map-search',
          placeholder: '搜索文件或函数…',
          value: search,
          onChange: (event) => {
            setSearch(event.target.value)
          },
        }),
        el(
          'select',
          {
            className: 'dvb-input dvb-map-filter',
            value: filter,
            onChange: (event) => {
              setFilter(event.target.value)
            },
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
            disabled: !keil.project,
            onClick() {
              setBusy(true)
              post('/dsh-vision-bench/keil/map', { cwd, project: keil.project, target: keil.target })
                .then((data) => {
                  setMapped(data && data.result && data.result.details ? data.result.details : mapped)
                })
                .catch(() => {})
                .finally(() => setBusy(false))
            },
          },
          '重新加载',
        ),
      ),
      !cwd
        ? el('div', { className: 'dvb-hint' }, t('needWorkspace'))
        : !keil.project
          ? el('div', { className: 'dvb-hint' }, t('projectMapEmpty'))
          : null,
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      mapped &&
        (truncated.files || truncated.includes || truncated.defines || truncated.include_edges || truncated.functions)
        ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('mapTruncated'))
        : null,
      busy ? el('div', { className: 'dvb-hint' }, t('opening')) : null,
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      // ── 编译配置（可折叠）──
      mapped && mapped.includes && mapped.includes.length
        ? el(
            'div',
            { className: 'dvb-map-block' },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-map-cfg-toggle',
                onClick() {
                  setCfgOpen((v) => !v)
                },
              },
              (cfgOpen ? '▾ ' : '▸ ') +
                t('mapIncludes') +
                ' · ' +
                String(counts.includes || mapped.includes.length) +
                ' · ' +
                (mapped.defines || []).length +
                ' 宏 · ' +
                String(counts.include_edges || (mapped.include_edges || []).length) +
                ' 依赖',
            ),
            cfgOpen
              ? el(
                  'div',
                  null,
                  el('div', { className: 'dvb-map-label' }, t('mapIncludes')),
                  mapped.includes.map((item, index) =>
                    el(
                      'div',
                      {
                        key: 'i' + index,
                        className: 'dvb-map-path',
                        'data-kind': item.exists ? (item.inside ? 'ok' : 'out') : 'missing',
                      },
                      item.path,
                    ),
                  ),
                  mapped.defines && mapped.defines.length
                    ? el('div', { className: 'dvb-map-label' }, t('mapDefines'))
                    : null,
                  mapped.defines ? el('div', { className: 'dvb-map-defs' }, mapped.defines.join(', ')) : null,
                  mapped.include_edges && mapped.include_edges.length
                    ? el('div', { className: 'dvb-map-label' }, t('mapIncludesOf'))
                    : null,
                  mapped.include_edges
                    ? mapped.include_edges.slice(0, 120).map((edge, index) =>
                        el(
                          'div',
                          {
                            key: 'e' + index,
                            className: 'dvb-map-path',
                            'data-kind': edge.resolved ? 'ok' : 'missing',
                          },
                          (edge.from || '') + ' → ' + (edge.to || edge.name || ''),
                        ),
                      )
                    : null,
                )
              : null,
          )
        : null,
      // ── 组 → 文件 → 函数 树 ──
      groups.map((group, gi) => {
        const gKey = group.name
        const gOpen = openGroups[gKey] !== false
        const groupFiles = (group.files || []).filter((file) => passesFilter(file))
        const needle = search.trim().toLowerCase()
        const shown = needle
          ? groupFiles.filter((f) =>
              (f.name + ' ' + (f.rel || '') + ' ' + (f.functions || []).map((fn) => fn.name).join(' '))
                .toLowerCase()
                .includes(needle),
            )
          : groupFiles
        return el(
          'div',
          { key: 'g' + gi, className: 'dvb-map-group' },
          el(
            'div',
            { className: 'dvb-map-group-name' },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-map-toggle',
                onClick() {
                  setOpenGroups((prev) => ({ ...prev, [gKey]: !(prev[gKey] !== false) }))
                },
              },
              gOpen ? '▾' : '▸',
            ),
            el(
              'span',
              null,
              (group.name || '') +
                ' · ' +
                String(groupFiles.length) +
                ' 文件' +
                (needle ? ' · 匹配 ' + shown.length : ''),
            ),
            el(
              'span',
              { className: 'dvb-hint' },
              (group.files || []).filter((f) => !f.inside).length +
                ' 工作区外 · ' +
                (group.files || []).filter((f) => !f.exists).length +
                ' 缺失',
            ),
          ),
          gOpen ? shown.map((file) => fileRow({ ...file, _group: group.name }, group.name)) : null,
        )
      }),
      // ── 源码预览 ──
      preview
        ? el(
            'div',
            { className: 'dvb-panel dvb-write-panel' },
            el(
              'div',
              { className: 'dvb-panel-head' },
              el('span', { className: 'dvb-panel-title' }, '源码预览 · ' + (preview.rel || '')),
              preview.truncated ? el('span', { className: 'dvb-hint dvb-need' }, '超过 256KB，已截断') : null,
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  onClick() {
                    setPreview(null)
                  },
                },
                t('csvCancel'),
              ),
            ),
            preview.loading
              ? el('div', { className: 'dvb-hint' }, t('opening'))
              : preview.error
                ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, preview.error)
                : el(
                    'pre',
                    {
                      className: 'dvb-log dvb-map-preview',
                      style: { maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre' },
                    },
                    preview.text,
                  ),
          )
        : null,
    )
  }
}

export function registerMap(ctx, React, t, MapPage) {
  const bs = ctx.betterSidebar
  return bs.registerTab({
    id: TAB_MAP,
    title() {
      return t('projectMap')
    },
    single: true,
    order: 74,
    component: MapPage,
  })
}

export function openProjectTab(side) {
  if (side && typeof side.openTab === 'function') side.openTab({ type: TAB_MAP })
}

// 工程结构定位（编译错误跳转）：调试页写入，map 页消费
let targetJump = null
export const setTargetJump = (jump) => {
  targetJump = jump
}
export const getTargetJump = () => targetJump
