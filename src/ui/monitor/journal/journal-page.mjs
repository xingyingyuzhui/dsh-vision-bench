import {
  buildAgentRef,
  buildInputBridge,
  dispatchAgentRef,
  evidenceFromRef,
  postEvidence,
  readInputDraft,
  subscribeState,
} from '../../../../bench-shared.mjs'
import { vendorUseVirtualizer } from '../../../../bench-vendor.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createDataTable } from '../../components/data-table.mjs'
import { createJournalDetailCard } from './journal-detail-card.mjs'
import { createJournalFilterToolbar } from './journal-filter-toolbar.mjs'
import {
  formatJournalResult,
  formatJournalSource,
  formatTimeOnly,
  isJournalSuccess,
} from './journal-format.mjs'

const useViz = vendorUseVirtualizer() || (() => null)

const PAGE_SIZE = 8

export function createLogPage(React, t, post, helpers = {}) {
  const el = React.createElement
  const useVizForPage = (helpers && typeof helpers.useVirtualizer === 'function' && helpers.useVirtualizer) || useViz
  const DataTable = createDataTable(React)
  const JournalFilterToolbar = createJournalFilterToolbar(React, t)
  const JournalDetailCard = createJournalDetailCard(React, t)

  return function LogPage(props) {
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)

    const [journal, setJournal] = React.useState({ tasks: [], running: [], timeline: [] })
    const [sourceFilter, setSourceFilter] = React.useState('all')
    const [resultFilter, setResultFilter] = React.useState('all')
    const [timeFilter, setTimeFilter] = React.useState('today')
    const [search, setSearch] = React.useState('')
    const [currentPage, setCurrentPage] = React.useState(1)
    const [selectedId, setSelectedId] = React.useState('')
    const [note, setNote] = React.useState('')

    React.useEffect(() => {
      setJournal({ tasks: [], running: [], timeline: [] })
      setSelectedId('')
      setCurrentPage(1)
    }, [cwd, sessionId])

    React.useEffect(
      () =>
        subscribeState(
          post,
          cwd,
          (data) => {
            if (data?.journal) setJournal(data.journal)
          },
          { sessionId },
        ),
      [cwd, post, sessionId],
    )

    const timeline = journal && Array.isArray(journal.timeline) ? journal.timeline : []

    // Filter logic
    const filtered = timeline.filter((item) => {
      // Source filter
      if (sourceFilter !== 'all') {
        const itemSrc = (item.source || 'system').toLowerCase()
        if (sourceFilter === 'user' && itemSrc !== 'user' && itemSrc !== 'manual') return false
        if (sourceFilter === 'agent' && itemSrc !== 'agent') return false
        if (sourceFilter === 'system' && itemSrc !== 'system' && itemSrc !== '') return false
      }

      // Result filter
      if (resultFilter !== 'all') {
        const isOk = isJournalSuccess(item)
        if (resultFilter === 'success' && !isOk) return false
        if (resultFilter === 'fail' && isOk) return false
      }

      // Time filter
      if (timeFilter !== 'all') {
        const itemTime = item.at || item.startedAt || 0
        const now = Date.now()
        if (timeFilter === 'today') {
          const startOfToday = new Date().setHours(0, 0, 0, 0)
          if (itemTime < startOfToday) return false
        } else if (timeFilter === '7d') {
          const sevenDaysAgo = now - 7 * 24 * 3600 * 1000
          if (itemTime < sevenDaysAgo) return false
        }
      }

      // Search keyword filter
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const text = `${item.summary || ''} ${item.kind || ''} ${item.id || ''} ${item.pointId || ''} ${item.deviceId || ''} ${item.taskId || ''}`.toLowerCase()
        if (!text.includes(q)) return false
      }

      return true
    })

    // Sorted descending by time
    const sorted = [...filtered].reverse()

    // Pagination
    const totalCount = sorted.length
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    const safePage = Math.min(currentPage, totalPages)
    const startIndex = (safePage - 1) * PAGE_SIZE
    const pageItems = sorted.slice(startIndex, startIndex + PAGE_SIZE)

    // Current selected item
    const selectedItem =
      (selectedId && sorted.find((it) => String(it.id) === String(selectedId))) ||
      pageItems[0] ||
      sorted[0] ||
      null

    // Reset handler
    const handleReset = () => {
      setSourceFilter('all')
      setResultFilter('all')
      setTimeFilter('all')
      setSearch('')
      setCurrentPage(1)
    }

    const jumpTarget = (item) => {
      const target =
        item &&
        (item.pointId
          ? { connectionId: item.connectionId, deviceId: item.deviceId, pointId: item.pointId }
          : item?.deviceId
            ? { connectionId: item.connectionId, deviceId: item.deviceId }
            : item?.connectionId
              ? { connectionId: item.connectionId }
              : {})
      if (helpers && typeof helpers.openHmi === 'function') {
        try {
          helpers.openHmi(target)
        } catch {}
      }
    }

    const handleAddToAgent = async (item) => {
      if (!item) return
      const fullText = `[操作记录] 时间: ${formatTimeOnly(item.at || item.startedAt)} 来源: ${formatJournalSource(item.source).label} 操作: ${item.summary || item.kind} 结果: ${isJournalSuccess(item) ? '成功' : '失败'}`

      if (item.pointId) {
        try {
          const ref = buildAgentRef(
            'point',
            {
              pointId: item.pointId,
              deviceId: item.deviceId,
              connectionId: item.connectionId,
            },
            { configVersion: 3 },
          )
          const res = await dispatchAgentRef(ref, agentBridge)
          setNote(res?.status === 'input' ? '已添加到 Agent 输入' : '已复制操作引用')
          setTimeout(() => setNote(''), 2500)
          if (cwd) {
            postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
              setNote(reason)
              setTimeout(() => setNote(''), 4000)
            })
          }
          return
        } catch {}
      }

      if (agentBridge && typeof agentBridge.setInput === 'function') {
        try {
          agentBridge.setInput(fullText)
          setNote('已填入 Agent 输入框')
          setTimeout(() => setNote(''), 2500)
          return
        } catch {}
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(fullText).then(() => {
            setNote('已复制到剪贴板')
            setTimeout(() => setNote(''), 2500)
          })
        }
      } catch {}
    }

    const columns = [
      {
        id: 'time',
        header: '时间',
        accessorFn: (item) => item.at || item.startedAt,
        cell: (info) => el('span', { className: 'dvb-time-cell' }, formatTimeOnly(info.getValue())),
      },
      {
        id: 'source',
        header: '来源',
        accessorFn: (item) => item.source || 'system',
        cell: (info) => {
          const s = formatJournalSource(info.getValue())
          return el('span', { className: `dvb-pill ${s.className}` }, `${s.icon} ${s.label}`)
        },
      },
      {
        id: 'summary',
        header: '操作摘要',
        minSize: 180,
        accessorFn: (item) => item.summary || item.kind || item.id,
        cell: (info) => {
          const item = info.row.original
          return el(
            'span',
            { className: 'dvb-summary-cell', title: item.kind + (item.taskId ? ` · ${item.taskId}` : '') },
            info.getValue(),
          )
        },
      },
      {
        id: 'result',
        header: '结果',
        accessorFn: (item) => isJournalSuccess(item),
        cell: (info) => {
          const res = formatJournalResult(info.row.original)
          return el('span', { className: `dvb-pill ${res.className}` }, `${res.icon} ${res.label}`)
        },
      },
    ]

    return el(
      'div',
      { className: 'dvb-page dvb-journal-page' },
      el(JournalFilterToolbar, {
        source: sourceFilter,
        onSourceChange: (s) => {
          setSourceFilter(s)
          setCurrentPage(1)
        },
        result: resultFilter,
        onResultChange: (r) => {
          setResultFilter(r)
          setCurrentPage(1)
        },
        time: timeFilter,
        onTimeChange: (t) => {
          setTimeFilter(t)
          setCurrentPage(1)
        },
        search,
        onSearchChange: (q) => {
          setSearch(q)
          setCurrentPage(1)
        },
        onReset: handleReset,
      }),
      note ? el('div', { className: 'dvb-msg', 'data-kind': 'info' }, note) : null,
      el(
        'div',
        { className: 'dvb-journal-split' },
        el(
          'div',
          { className: 'dvb-journal-main' },
          el(DataTable, {
            data: pageItems,
            getRowId: (item) => String(item.id),
            virtualize: false,
            columns,
            selectedId: selectedItem ? String(selectedItem.id) : undefined,
            onRowClick(item) {
              setSelectedId(String(item.id))
            },
            getRowProps(row) {
              const item = row.original
              const isSelected = selectedItem && String(selectedItem.id) === String(item.id)
              return {
                className: `dvb-live-row${isSelected ? ' is-on is-selected' : ''}`,
                'data-source': item.source,
                'data-ok': isJournalSuccess(item) ? 'true' : 'false',
              }
            },
          }),
          el(
            'div',
            { className: 'dvb-pagination' },
            el(
              'span',
              { className: 'dvb-pagination-info' },
              totalCount > 0
                ? `显示 ${startIndex + 1}-${Math.min(startIndex + PAGE_SIZE, totalCount)} 条，共 ${totalCount} 条`
                : '暂无记录',
            ),
            totalPages > 1
              ? el(
                  'div',
                  { className: 'dvb-pagination-controls' },
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-pagination-btn',
                      disabled: safePage <= 1,
                      onClick() {
                        setCurrentPage(Math.max(1, safePage - 1))
                      },
                    },
                    '<',
                  ),
                  Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pg) =>
                    el(
                      'button',
                      {
                        key: pg,
                        type: 'button',
                        className: `dvb-pagination-btn${pg === safePage ? ' is-active' : ''}`,
                        onClick() {
                          setCurrentPage(pg)
                        },
                      },
                      String(pg),
                    ),
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-pagination-btn',
                      disabled: safePage >= totalPages,
                      onClick() {
                        setCurrentPage(Math.min(totalPages, safePage + 1))
                      },
                    },
                    '>',
                  ),
                )
              : null,
          ),
        ),
        el(JournalDetailCard, {
          item: selectedItem,
          onAddToAgent: handleAddToAgent,
          onJumpTask: jumpTarget,
        }),
      ),
    )
  }
}
