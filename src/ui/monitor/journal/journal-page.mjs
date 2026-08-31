import { clockOf } from '../../../../bench-points.mjs'
import { subscribeState } from '../../../../bench-shared.mjs'
import { vendorUseVirtualizer } from '../../../../bench-vendor.mjs'
import { createDataTable } from '../../components/data-table.mjs'

const useViz = vendorUseVirtualizer() || (() => null)

export function createLogPage(React, t, post, helpers = {}) {
  const el = React.createElement
  const useVizForPage = (helpers && typeof helpers.useVirtualizer === 'function' && helpers.useVirtualizer) || useViz
  const DataTable = createDataTable(React)
  const FILTERS = [
    { key: 'all', label: t('logFilterAll') || '全部' },
    { key: 'user', label: t('logFilterUser') || '用户' },
    { key: 'agent', label: t('logFilterAgent') || 'Agent' },
    { key: 'system', label: t('logFilterSystem') || '系统' },
    { key: 'err', label: t('logFilterErr') || '错误' },
  ]
  return function LogPage(props) {
    const cwd = props?.scope?.cwd || props?.cwd || ''
    const [journal, setJournal] = React.useState({ tasks: [], running: [], timeline: [] })
    const [filter, setFilter] = React.useState('all')
    const [note, setNote] = React.useState('')
    React.useEffect(
      () =>
        subscribeState(post, cwd, (data) => {
          if (data?.journal) setJournal(data.journal)
        }),
      [cwd, post],
    )
    const tasks = journal && Array.isArray(journal.tasks) ? journal.tasks : []
    const timeline = journal && Array.isArray(journal.timeline) ? journal.timeline : []
    const running = journal && Array.isArray(journal.running) ? journal.running : []
    const filtered = timeline.filter((item) => {
      if (filter === 'err')
        return item.ok === false || item.kind === 'error' || String(item.summary || '').indexOf('异常') >= 0
      if (filter === 'all') return true
      return (item.source || 'system') === filter
    })
    const jump = (item) => {
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
        return
      }
    }
    const copyLine = (item) => {
      const line = `[${String(item.source || 'system')}] ${clockOf(item.at)} ${item.summary || item.kind || item.id}`
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(line).then(
            () => setNote(`已复制: ${item.summary || item.kind}`),
            () => setNote('复制失败'),
          )
        } else {
          setNote('复制失败（无剪贴板）')
        }
      } catch {
        setNote('复制失败')
      }
    }
    const viewFrames = (item) => {
      if (helpers && typeof helpers.openFrames === 'function') {
        try {
          helpers.openFrames()
        } catch {}
      }
    }
    return el(
      'div',
      { className: 'dvb-page' },
      el(
        'div',
        { className: 'dvb-toolbar', style: { flexWrap: 'wrap' } },
        FILTERS.map((f) =>
          el(
            'button',
            {
              key: f.key,
              type: 'button',
              className: `dvb-btn dvb-btn-sm${filter === f.key ? ' dvb-btn-primary' : ''}`,
              onClick() {
                setFilter(f.key)
              },
            },
            f.label,
          ),
        ),
        running.length ? el('span', { className: 'dvb-tag' }, `运行中 ${running.length}`) : null,
        el('span', { className: 'dvb-hint' }, `共 ${filtered.length} 条`),
      ),
      tasks.length
        ? el(
            'div',
            { className: 'dvb-journal' },
            el('div', { className: 'dvb-journal-title' }, t('tasks') || '任务'),
            tasks
              .slice(0, 6)
              .map((item) =>
                el(
                  'div',
                  { key: item.id, className: 'dvb-task', 'data-status': item.status, 'data-source': item.source },
                  el('span', { className: 'dvb-badge' }, clockOf(item.startedAt)),
                  el('span', { className: 'dvb-badge', 'data-source': item.source }, String(item.source || '')),
                  el('span', null, item.summary || String(item.type || '任务')),
                  item.status ? el('span', { className: 'dvb-badge' }, String(item.status)) : null,
                ),
              ),
          )
        : null,
      filtered.length
        ? el(
            'div',
            { className: 'dvb-journal' },
            el('div', { className: 'dvb-journal-title' }, t('liveLog') || '操作记录'),
            el(DataTable, {
              data: filtered.slice(-200).reverse(),
              getRowId: (item) => String(item.id),
              virtualize: true,
              useVirtualizer: useVizForPage,
              estimateSize: 36,
              overscan: 8,
              height: 320,
              fallbackCap: 200,
              listClassName: 'dvb-live-list',
              getRowProps(row) {
                const item = row.original
                return {
                  className: 'dvb-event',
                  'data-source': item.source,
                  'data-ok': item.ok === false ? 'false' : item.ok === true ? 'true' : '',
                }
              },
              columns: [
                {
                  id: 'time',
                  header: '时间',
                  accessorFn: (item) => item.at,
                  cell: (info) => el('span', { className: 'dvb-badge' }, clockOf(info.getValue())),
                },
                {
                  id: 'source',
                  header: '来源',
                  accessorFn: (item) => item.source || 'system',
                  cell: (info) =>
                    el('span', { className: 'dvb-badge', 'data-source': info.getValue() }, String(info.getValue())),
                },
                {
                  id: 'summary',
                  header: '摘要',
                  minSize: 180,
                  accessorFn: (item) => item.summary || item.kind || item.id,
                  cell: (info) => {
                    const item = info.row.original
                    return el(
                      'span',
                      { className: 'dvb-hint', title: item.kind + (item.taskId ? ` · ${item.taskId}` : '') },
                      info.getValue(),
                    )
                  },
                },
                {
                  id: 'ops',
                  header: '',
                  enableSorting: false,
                  minSize: 140,
                  accessorFn: (item) => item.id,
                  cell: (info) => {
                    const item = info.row.original
                    return el(
                      'span',
                      { className: 'dvb-data-ops' },
                      item.pointId || item.connectionId
                        ? el(
                            'button',
                            {
                              type: 'button',
                              className: 'dvb-btn dvb-btn-sm',
                              title: '跳转到目标',
                              onClick() {
                                jump(item)
                              },
                            },
                            t('logJump') || '跳转',
                          )
                        : null,
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm',
                          title: '复制给 Agent',
                          onClick() {
                            copyLine(item)
                          },
                        },
                        t('logCopyAgent') || '复制',
                      ),
                      item.frameId
                        ? el(
                            'button',
                            {
                              type: 'button',
                              className: 'dvb-btn dvb-btn-sm',
                              onClick() {
                                viewFrames(item)
                              },
                            },
                            t('logViewFrames') || '报文',
                          )
                        : null,
                    )
                  },
                },
              ],
            }),
          )
        : null,
      note ? el('div', { className: 'dvb-hint' }, note) : null,
    )
  }
}
