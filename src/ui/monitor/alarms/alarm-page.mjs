import { COMM, COND_ACTIVE, PROCESS, acknowledgeAlarm, groupAlarms } from '../../../../bench-alarm.mjs'
import { normalizeModbus } from '../../../../bench-devices.mjs'
import { clockOf } from '../../../../bench-points.mjs'
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
import { createAlarmDetailCard } from './alarm-detail-card.mjs'
import { createAlarmFilterToolbar } from './alarm-filter-toolbar.mjs'
import {
  formatAlarmAck,
  formatAlarmCondition,
  formatAlarmSeverity,
  formatAlarmSubtitle,
  formatAlarmTitle,
  formatTimeOnly,
} from './alarm-format.mjs'

const useViz = vendorUseVirtualizer() || (() => null)

export function createAlarmPage(React, t, post, hooks) {
  const openHmi = hooks?.openHmi
  const useVizForPage = (hooks && typeof hooks.useVirtualizer === 'function' && hooks.useVirtualizer) || useViz
  const DataTable = createDataTable(React)
  const AlarmFilterToolbar = createAlarmFilterToolbar(React, t)
  const AlarmDetailCard = createAlarmDetailCard(React, t)

  return function AlarmPage(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)

    const [events, setEvents] = React.useState([])
    const [alarmState, setAlarmState] = React.useState({})
    const [pack, setPack] = React.useState(null)

    // Filters
    const [typeFilter, setTypeFilter] = React.useState('all')
    const [severityFilter, setSeverityFilter] = React.useState('all')
    const [timeFilter, setTimeFilter] = React.useState('today')
    const [search, setSearch] = React.useState('')

    // Selection & details
    const [selectedId, setSelectedId] = React.useState('')
    const [checkedIds, setCheckedIds] = React.useState(new Set())
    const [note, setNote] = React.useState('')

    React.useEffect(() => {
      setEvents([])
      setAlarmState({})
      setPack(null)
      setSelectedId('')
      setCheckedIds(new Set())
    }, [cwd, sessionId])

    React.useEffect(
      () =>
        subscribeState(
          post,
          cwd,
          (data) => {
            if (!data) return
            const timeline = data.journal && Array.isArray(data.journal.timeline) ? data.journal.timeline : []
            setEvents(timeline.filter((item) => item.kind === 'alarm' || item.kind === 'alarm-clear'))
            const mb = data.workspace?.modbus
            if (mb) {
              setAlarmState(mb.alarmState || mb.alarmActive || {})
              try {
                setPack(normalizeModbus(mb))
              } catch {
                setPack(null)
              }
            }
          },
          { sessionId },
        ),
      [cwd, post, sessionId],
    )

    const grouped = groupAlarms(alarmState)
    const allAlarms = grouped.all || []

    // Enrich alarms with points, devices, connections
    const enriched = allAlarms
      .map((a) => {
        const pt = pack && a.pointId ? (pack.points || []).find((p) => p.id === a.pointId) : null
        const conn = pack && a.connectionId ? (pack.connections || []).find((c) => c.id === a.connectionId) : null
        const dev = pack && a.deviceId ? (pack.devices || []).find((d) => d.id === a.deviceId) : null
        const threshold = a.threshold != null ? a.threshold : pt ? (a.kind === 'max' ? pt.alarmMax : pt.alarmMin) : null
        const label = pt ? pt.name || a.pointId : a.label || a.connectionId || a.id
        return { a, pt, conn, dev, threshold, label }
      })
      .filter((row) => {
        const { a, pt, conn, dev, label } = row

        // Type filter (process / comm)
        if (typeFilter !== 'all') {
          if (typeFilter === 'process' && a.group !== PROCESS) return false
          if (typeFilter === 'comm' && a.group !== COMM && !String(a.id).startsWith('comm:')) return false
        }

        // Severity filter (critical / warn)
        if (severityFilter !== 'all') {
          const s = String(a.severity || '').toLowerCase()
          const isCrit = s === 'high' || s === 'critical' || s === '严重'
          if (severityFilter === 'critical' && !isCrit) return false
          if (severityFilter === 'warn' && isCrit) return false
        }

        // Time filter
        if (timeFilter !== 'all') {
          const itemTime = a.firstAt || a.lastAt || 0
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
          const title = formatAlarmTitle(a, pt, conn, dev).toLowerCase()
          const subtitle = formatAlarmSubtitle(a, pt, conn, dev).toLowerCase()
          const targetStr = `${label || ''} ${a.id || ''} ${a.pointId || ''} ${a.deviceId || ''} ${a.connectionId || ''}`.toLowerCase()
          if (!title.includes(q) && !subtitle.includes(q) && !targetStr.includes(q)) return false
        }

        return true
      })
      .sort((x, y) => (y.a.lastAt || 0) - (x.a.lastAt || 0))

    // Selected row for detail card
    const selectedRow =
      (selectedId && enriched.find((row) => String(row.a.id) === String(selectedId))) ||
      enriched[0] ||
      null

    // Counts
    const unackedCount = enriched.filter((row) => !row.a.acknowledged).length

    // Acknowledge single
    const doAck = (id) => {
      const next = acknowledgeAlarm(alarmState, id, { by: 'user' })
      if (next?._suggested) return
      setAlarmState(next)
      if (cwd) post('/dsh-vision-bench/workspace', { cwd, modbus: { alarmState: next, version: 3 } }).catch(() => {})
      setNote('告警已确认')
      setTimeout(() => setNote(''), 2000)
    }

    // Batch acknowledge
    const doBatchAck = () => {
      if (checkedIds.size === 0) return
      let nextState = alarmState
      for (const id of checkedIds) {
        nextState = acknowledgeAlarm(nextState, id, { by: 'user' })
      }
      setAlarmState(nextState)
      if (cwd) post('/dsh-vision-bench/workspace', { cwd, modbus: { alarmState: nextState, version: 3 } }).catch(() => {})
      setCheckedIds(new Set())
      setNote(`已确认 ${checkedIds.size} 条告警`)
      setTimeout(() => setNote(''), 2000)
    }

    // Acknowledge all
    const doAckAll = () => {
      doAck('all')
    }

    const sendToAgentAlarm = async (row) => {
      if (!row || !row.a) return
      const cv = pack ? pack.configVersion || 1 : 1
      const ref = buildAgentRef(
        'alarm',
        {
          alarmId: row.a.id,
          connectionId: row.a.connectionId,
          deviceId: row.a.deviceId,
          pointId: row.a.pointId,
          label: row.label,
          start: row.a.firstAt || row.a.lastAt,
          end: row.a.lastAt,
        },
        { configVersion: cv, start: row.a.firstAt || row.a.lastAt, end: row.a.lastAt },
      )
      const res = await dispatchAgentRef(ref, agentBridge)
      setNote(res?.status || '已复制告警引用')
      setTimeout(() => setNote(''), 2000)
      if (cwd) {
        try {
          postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
            setNote(reason)
            setTimeout(() => setNote(''), 4000)
          })
        } catch {}
      }
    }

    // Reset filters
    const handleReset = () => {
      setTypeFilter('all')
      setSeverityFilter('all')
      setTimeFilter('all')
      setSearch('')
    }

    const jumpPoint = (row) => {
      if (typeof openHmi === 'function' && row.pt) {
        try {
          openHmi({ connectionId: row.a.connectionId, deviceId: row.a.deviceId, pointId: row.a.pointId })
        } catch {}
      }
    }

    // Checkbox selection
    const isAllChecked = enriched.length > 0 && enriched.every((r) => checkedIds.has(String(r.a.id)))
    const toggleSelectAll = () => {
      if (isAllChecked) {
        setCheckedIds(new Set())
      } else {
        setCheckedIds(new Set(enriched.map((r) => String(r.a.id))))
      }
    }

    const toggleCheckRow = (id, e) => {
      e.stopPropagation()
      const next = new Set(checkedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      setCheckedIds(next)
    }

    const columns = [
      {
        id: 'select',
        header: () =>
          el('input', {
            type: 'checkbox',
            className: 'dvb-checkbox dvb-checkbox-all',
            checked: isAllChecked,
            onChange: toggleSelectAll,
          }),
        size: 36,
        minSize: 36,
        maxSize: 40,
        enableSorting: false,
        accessorFn: (row) => row.a.id,
        cell: (info) => {
          const id = String(info.getValue())
          const checked = checkedIds.has(id)
          return el('input', {
            type: 'checkbox',
            className: 'dvb-checkbox',
            checked,
            onChange: (e) => toggleCheckRow(id, e),
          })
        },
      },
      {
        id: 'time',
        header: '发生时间',
        size: 80,
        minSize: 76,
        accessorFn: (row) => row.a.firstAt || row.a.lastAt,
        cell: (info) => el('span', { className: 'dvb-time-cell' }, formatTimeOnly(info.getValue())),
      },
      {
        id: 'content',
        header: '告警内容',
        minSize: 200,
        accessorFn: (row) => row.a.id,
        cell: (info) => {
          const { a, pt, conn, dev } = info.row.original
          const title = formatAlarmTitle(a, pt, conn, dev)
          const subtitle = formatAlarmSubtitle(a, pt, conn, dev)
          return el(
            'div',
            { className: 'dvb-alarm-cell' },
            el('div', { className: 'dvb-alarm-cell-title' }, title),
            el('div', { className: 'dvb-alarm-cell-subtitle' }, subtitle),
          )
        },
      },
      {
        id: 'severity',
        header: '级别',
        size: 80,
        minSize: 76,
        accessorFn: (row) => row.a.severity || 'medium',
        cell: (info) => {
          const sev = formatAlarmSeverity(info.getValue())
          return el('span', { className: `dvb-pill ${sev.className}` }, `${sev.icon} ${sev.label}`)
        },
      },
      {
        id: 'status',
        header: '状态',
        size: 140,
        minSize: 130,
        accessorFn: (row) => row.a.condition,
        cell: (info) => {
          const a = info.row.original.a
          const cond = formatAlarmCondition(a)
          const ack = formatAlarmAck(a)
          return el(
            'span',
            { className: 'dvb-alarm-status-pills' },
            el('span', { className: `dvb-pill ${cond.className}` }, cond.label),
            el('span', { className: `dvb-pill ${ack.className}` }, ack.label),
          )
        },
      },
    ]

    return el(
      'div',
      { className: 'dvb-page dvb-alarm-page' },
      el(AlarmFilterToolbar, {
        type: typeFilter,
        onTypeChange: setTypeFilter,
        severity: severityFilter,
        onSeverityChange: setSeverityFilter,
        time: timeFilter,
        onTimeChange: setTimeFilter,
        search,
        onSearchChange: setSearch,
        onReset: handleReset,
      }),
      note ? el('div', { className: 'dvb-msg', 'data-kind': 'info' }, note) : null,
      el(
        'div',
        { className: 'dvb-alarms-split' },
        el(
          'div',
          { className: 'dvb-alarms-main' },
          el(DataTable, {
            data: enriched,
            getRowId: (row) => String(row.a.id),
            virtualize: false,
            columns,
            selectedId: selectedRow ? String(selectedRow.a.id) : undefined,
            onRowClick(row) {
              setSelectedId(String(row.a.id))
            },
            getRowProps(row) {
              const a = row.original.a
              const isSelected = selectedRow && String(selectedRow.a.id) === String(a.id)
              return {
                className: `dvb-live-row${isSelected ? ' is-on is-selected' : ''}`,
                'data-status': a.status,
                'data-condition': a.condition,
                'data-acked': a.acknowledged ? 'true' : 'false',
                'data-group': a.group,
              }
            },
          }),
          el(
            'div',
            { className: 'dvb-alarms-foot' },
            el(
              'span',
              { className: 'dvb-alarms-foot-info' },
              `已显示 ${enriched.length} 条 · 未确认 ${unackedCount} 条`,
            ),
            checkedIds.size > 0
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                    onClick: doBatchAck,
                  },
                  `批量确认 (${checkedIds.size})`,
                )
              : unackedCount > 0
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm',
                      onClick: doAckAll,
                    },
                    '全部确认',
                  )
                : null,
          ),
        ),
        el(AlarmDetailCard, {
          row: selectedRow,
          onAck: doAck,
          onJumpPoint: jumpPoint,
          onSendToAgent: sendToAgentAlarm,
        }),
      ),
    )
  }
}
