import { buildAgentRef, copyAgentRef, hasHarnessInput } from '../../../../bench-shared.mjs'
import { copyText, fileKindMark } from './project-shared.mjs'
import { fileKind, fileTreeId } from './project-tree-model.mjs'

export function createProjectTreePanel(React) {
  return function ProjectTreePanel({
    props,
    tree,
    openGroups,
    setOpenGroups,
    openFiles,
    setOpenFiles,
    selectedId,
    setSelectedId,
    jumpLine,
    onPreview,
    onCopyPath,
    onCopied,
  }) {
    const el = React.createElement
    const [menuId, setMenuId] = React.useState('')
    const selectedRowRef = React.useRef(null)

    React.useEffect(() => {
      const row = selectedRowRef.current
      if (!row || !selectedId) return
      try {
        row.scrollIntoView({ block: 'nearest', behavior: 'auto' })
      } catch {
        /* scroll optional */
      }
    }, [selectedId, jumpLine])

    const copyToAgent = (file) => {
      const ref = buildAgentRef('file', {
        file: file.rel || file.path || file.name,
        group: file._group || '',
        functions: (file.functions || []).slice(0, 20).map((fn) => fn.name),
      })
      copyAgentRef(ref, () => onCopied('已复制文件引用'))
    }

    const fileRow = (file) => {
      const kind = fileKind(file)
      const fid = fileTreeId(file)
      const isOpen = !!openFiles[fid]
      const jumpHere = jumpLine > 0 && selectedId === fid
      const mark = fileKindMark(kind)
      const menuOpen = menuId === fid
      const showAgent = hasHarnessInput(props)

      return el(
        'div',
        {
          key: `f${fid}`,
          className: `dvb-map-file-row${selectedId === fid ? ' is-on' : ''}`,
          'data-kind': kind,
          'data-treeid': fid,
          ref: selectedId === fid ? selectedRowRef : undefined,
        },
        el(
          'div',
          { className: 'dvb-map-file', 'data-kind': kind, title: file.rel || file.name },
          file.functions?.length
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-sm dvb-map-toggle',
                  'aria-label': isOpen ? '折叠函数列表' : '展开函数列表',
                  onClick() {
                    setOpenFiles((prev) => ({ ...prev, [fid]: !prev[fid] }))
                    setSelectedId(fid)
                  },
                },
                isOpen ? '▾' : '▸',
              )
            : el('span', { className: 'dvb-map-toggle dvb-map-toggle-void', 'aria-hidden': 'true' }, '·'),
          el(
            'button',
            {
              type: 'button',
              className: `dvb-btn dvb-btn-sm dvb-map-file-name${jumpHere ? ' dvb-map-jump' : ''}`,
              title: file.rel || file.name,
              onClick() {
                setSelectedId(fid)
                setMenuId('')
                onPreview(file)
              },
            },
            file.name,
          ),
          mark ? el('span', { className: 'dvb-map-file-mark', 'data-kind': kind }, mark) : null,
          el(
            'div',
            { className: 'dvb-map-file-actions' },
            el(
              'div',
              { className: 'dvb-project-file-menu' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-sm dvb-btn-icon',
                  title: '文件操作',
                  'aria-expanded': menuOpen ? 'true' : 'false',
                  onClick(ev) {
                    ev.stopPropagation()
                    setMenuId(menuOpen ? '' : fid)
                  },
                },
                '⋯',
              ),
              menuOpen
                ? el(
                    'div',
                    { className: 'dvb-project-file-menu-pop', role: 'menu' },
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        role: 'menuitem',
                        onClick() {
                          setMenuId('')
                          onPreview(file)
                        },
                      },
                      '预览',
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        role: 'menuitem',
                        onClick() {
                          setMenuId('')
                          copyText(file.rel || file.path || file.name, onCopyPath)
                        },
                      },
                      '复制路径',
                    ),
                    showAgent
                      ? el(
                          'button',
                          {
                            type: 'button',
                            className: 'dvb-btn dvb-btn-sm',
                            role: 'menuitem',
                            onClick() {
                              setMenuId('')
                              copyToAgent(file)
                            },
                          },
                          '让 Agent 分析',
                        )
                      : null,
                  )
                : null,
            ),
          ),
        ),
        isOpen && file.functions?.length
          ? el(
              'div',
              { className: 'dvb-map-funcs' },
              file.functions.map((fn) =>
                el(
                  'div',
                  {
                    key: `${fn.name}:${fn.line}`,
                    className: 'dvb-map-func',
                    'data-jump': jumpHere && fn.line === jumpLine ? 'true' : '',
                  },
                  el('span', { className: 'dvb-map-func-name' }, fn.name),
                  el('span', { className: 'dvb-map-meta' }, `line ${fn.line || '?'}`),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm',
                      title: '打开文件并定位到函数行',
                      onClick() {
                        setSelectedId(fid)
                        setMenuId('')
                        onPreview(file, fn.line || 0)
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
      {
        className: 'dvb-map-tree',
        tabIndex: 0,
        onKeyDown(ev) {
          if (ev.key !== 'Enter' && ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
          const ids = []
          for (const group of tree) {
            ids.push(group.id)
            if (openGroups[group.name] === false) continue
            for (const file of group.files) ids.push(fileTreeId(file))
          }
          if (!ids.length) return
          const cur = Math.max(0, ids.indexOf(selectedId))
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault()
            const next = ev.key === 'ArrowDown' ? Math.min(ids.length - 1, cur + 1) : Math.max(0, cur - 1)
            setSelectedId(ids[next])
          }
        },
        onClick() {
          if (menuId) setMenuId('')
        },
      },
      tree.map((group) => {
        const gKey = group.name
        const gOpen = openGroups[gKey] !== false
        return el(
          'div',
          { key: group.id, className: 'dvb-map-group', 'data-treeid': group.id },
          el(
            'div',
            { className: 'dvb-map-group-name' },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-map-toggle',
                'aria-label': gOpen ? '折叠组' : '展开组',
                onClick() {
                  setOpenGroups((prev) => ({ ...prev, [gKey]: !(prev[gKey] !== false) }))
                  setSelectedId(group.id)
                },
              },
              gOpen ? '▾' : '▸',
            ),
            el(
              'span',
              null,
              `${group.name || ''} · ${String(group.total)} 文件${group.matched !== group.total ? ` · 匹配 ${group.matched}` : ''}`,
            ),
            el('span', { className: 'dvb-hint' }, `${group.outside} 外 · ${group.missing} 缺`),
          ),
          gOpen ? group.files.map((file) => fileRow({ ...file, _group: group.name })) : null,
        )
      }),
    )
  }
}
