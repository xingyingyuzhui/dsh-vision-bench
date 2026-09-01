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
import { alarmListForView } from './alarm-filter-model.mjs'

const useViz = vendorUseVirtualizer() || (() => null)

export function createAlarmPage(React, t, post, hooks) {
  const openHmi = hooks?.openHmi
  const openLive = hooks?.openHmi
  const useVizForPage = (hooks && typeof hooks.useVirtualizer === 'function' && hooks.useVirtualizer) || useViz
  const DataTable = createDataTable(React)
  return function AlarmPage(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    // Task5/0.18.2: hook reads at render top-level, passed into the pure dispatch bridge
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const [events, setEvents] = React.useState([])
    const [alarmState, setAlarmState] = React.useState({})
    const [pack, setPack] = React.useState(null)
    const [view, setView] = React.useState('activeUnacked')
    const [group, setGroup] = React.useState('all')
    React.useEffect(() => {
      setEvents([])
      setAlarmState({})
      setPack(null)
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
    const filtered = alarmListForView(grouped, view, group)
    // enrich with point/connection/device labels
    const [copiedAlarm, setCopiedAlarm] = React.useState('')
    const [evNote, setEvNote] = React.useState('')
    const enriched = filtered
      .map((a) => {
        const pt = pack && a.pointId ? (pack.points || []).find((p) => p.id === a.pointId) : null
        const conn = pack && a.connectionId ? (pack.connections || []).find((c) => c.id === a.connectionId) : null
        const dev = pack && a.deviceId ? (pack.devices || []).find((d) => d.id === a.deviceId) : null
        const threshold = a.threshold != null ? a.threshold : pt ? (a.kind === 'max' ? pt.alarmMax : pt.alarmMin) : null
        const label = pt ? pt.name || a.pointId : a.label || a.connectionId || a.id
        return { a, pt, conn, dev, threshold, label }
      })
      .sort((x, y) => (y.a.lastAt || 0) - (x.a.lastAt || 0))
    const doAck = (id) => {
      const next = acknowledgeAlarm(alarmState, id, { by: 'user' })
      if (next?._suggested) return
      setAlarmState(next)
      if (cwd) post('/dsh-vision-bench/workspace', { cwd, modbus: { alarmState: next, version: 3 } }).catch(() => {})
    }
    const sendToAgentAlarm = async (row) => {
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
      // Task5/0.18.2: unified status enum input|sent|copied|failed — surface it on screen
      setCopiedAlarm(`${row.a.id}:${res?.status || '复制失败'}`)
      setTimeout(() => setCopiedAlarm(''), 2000)
      if (cwd) {
        // Task4/0.18.2: typed evidence back-mount — failures surface CONFIG_DRIFT/TARGET_MISMATCH
        try {
          postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
            setEvNote(reason)
            setTimeout(() => setEvNote(''), 4000)
          })
        } catch {}
      }
    }
    const focusAlarm = (row) => {
      if (!cwd) return
      post('/dsh-vision-bench/focus', {
        cwd,
        target: {
          alarmId: row.a.id,
          connectionId: row.a.connectionId,
          deviceId: row.a.deviceId,
          pointId: row.a.pointId,
          kind: 'alarm',
        },
      }).catch(() => {})
    }
    const jumpPoint = (row) => {
      if (typeof openHmi === 'function' && row.pt)
        try {
          openHmi({ connectionId: row.a.connectionId, deviceId: row.a.deviceId, pointId: row.a.pointId })
        } catch {}
    }
    const jumpChart = () => {
      if (typeof openLive === 'function')
        try {
          openLive()
        } catch {}
    }
    const jumpFrames = (row) => {
      if (typeof openLive === 'function')
        try {
          openLive()
        } catch {}
    }
    return el(
      'div',
      { className: 'dvb-live' },
      el(
        'div',
        { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveAlarm')),
        el(
          'span',
          {
            className: 'dvb-chip',
            'data-kind': grouped.activeAll?.length || grouped.active.length ? 'err' : 'ready',
          },
          `${grouped.activeAll?.length || grouped.active.length} 激活`,
        ),
      ),
      el(
        'div',
        { className: 'dvb-toolbar' },
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${view === 'activeUnacked' ? ' is-on' : ''}`,
            onClick() {
              setView('activeUnacked')
            },
          },
          `激活未确认${grouped.buckets ? `·${grouped.buckets.activeUnacked.length}` : ''}`,
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${view === 'activeAcked' ? ' is-on' : ''}`,
            onClick() {
              setView('activeAcked')
            },
          },
          `激活已确认${grouped.buckets ? `·${grouped.buckets.activeAcked.length}` : ''}`,
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${view === 'recoveredUnacked' ? ' is-on' : ''}`,
            onClick() {
              setView('recoveredUnacked')
            },
          },
          `已恢复未确认${grouped.buckets ? `·${grouped.buckets.recoveredUnacked.length}` : ''}`,
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${view === 'recoveredAcked' ? ' is-on' : ''}`,
            onClick() {
              setView('recoveredAcked')
            },
          },
          `已恢复已确认·历史${grouped.buckets ? `·${grouped.buckets.recoveredAcked.length}` : ''}`,
        ),
        el('span', { style: { width: '8px', display: 'inline-block' } }),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${group === 'all' ? ' is-on' : ''}`,
            onClick() {
              setGroup('all')
            },
          },
          '全部',
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${group === PROCESS ? ' is-on' : ''}`,
            onClick() {
              setGroup(PROCESS)
            },
          },
          '过程',
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${group === COMM ? ' is-on' : ''}`,
            onClick() {
              setGroup(COMM)
            },
          },
          '通信',
        ),
        enriched.length
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                onClick() {
                  doAck('all')
                },
              },
              '全部确认',
            )
          : null,
      ),
      copiedAlarm || evNote
        ? el(
            'div',
            { className: `dvb-hint${evNote ? ' dvb-err' : ''}`, 'data-kind': evNote ? 'err' : undefined },
            evNote || `${copiedAlarm.split(':').pop()} · ${copiedAlarm.split(':')[0]}`,
          )
        : null,
      enriched.length
        ? el(DataTable, {
            data: enriched,
            getRowId: (row) => String(row.a.id),
            virtualize: true,
            useVirtualizer: useVizForPage,
            estimateSize: 40,
            overscan: 8,
            height: 320,
            fallbackCap: 80,
            listClassName: 'dvb-live-list',
            getRowProps(row) {
              const a = row.original.a
              return {
                className: 'dvb-task',
                'data-status': a.status,
                'data-condition': a.condition,
                'data-acked': a.acknowledged ? 'true' : 'false',
                'data-group': a.group,
              }
            },
            columns: [
              {
                id: 'cond',
                header: '状态',
                accessorFn: (row) => row.a.condition,
                cell: (info) => {
                  const a = info.row.original.a
                  const condLabel =
                    a.condition === COND_ACTIVE
                      ? a.acknowledged
                        ? '激活已确认'
                        : '激活未确认'
                      : a.acknowledged
                        ? '已恢复已确认'
                        : '已恢复未确认'
                  return el(
                    'span',
                    { className: 'dvb-badge', 'data-status': a.status, 'data-condition': a.condition },
                    condLabel,
                  )
                },
              },
              {
                id: 'group',
                header: '分组',
                accessorFn: (row) => row.a.group,
                cell: (info) =>
                  el(
                    'span',
                    { className: 'dvb-badge', 'data-group': info.getValue() },
                    info.getValue() === COMM ? '通信' : '过程',
                  ),
              },
              {
                id: 'severity',
                header: '级别',
                accessorFn: (row) => row.a.severity || 'medium',
                cell: (info) =>
                  el('span', { className: 'dvb-badge', 'data-severity': info.getValue() }, info.getValue() || ''),
              },
              {
                id: 'time',
                header: '时间',
                accessorFn: (row) => row.a.lastAt,
                cell: (info) => el('span', { className: 'dvb-map-meta' }, clockOf(info.getValue())),
              },
              {
                id: 'label',
                header: '对象',
                minSize: 120,
                accessorFn: (row) => row.label,
                cell: (info) => el('span', { className: 'dvb-hint', title: info.row.original.a.id }, info.getValue()),
              },
              {
                id: 'conn',
                header: '连接',
                accessorFn: (row) => (row.conn ? row.conn.name : ''),
              },
              {
                id: 'dev',
                header: '设备',
                accessorFn: (row) => (row.dev ? `${row.dev.name}·站号 ${row.dev.unitId}` : ''),
              },
              {
                id: 'threshold',
                header: '阈值',
                accessorFn: (row) => row.a.threshold,
                cell: (info) => (info.getValue() != null ? `阈值 ${info.getValue()}` : ''),
              },
              {
                id: 'value',
                header: '当前',
                accessorFn: (row) => row.a.value,
                cell: (info) => (info.getValue() != null ? `当前 ${info.getValue()}` : ''),
              },
              {
                id: 'quality',
                header: '质量',
                accessorFn: (row) => row.a.quality || 'good',
                cell: (info) =>
                  el('span', { className: 'dvb-badge', 'data-quality': info.getValue() }, info.getValue()),
              },
              {
                id: 'count',
                header: '次数',
                accessorFn: (row) => row.a.count,
                cell: (info) =>
                  info.getValue() > 1 ? el('span', { className: 'dvb-tag' }, `×${info.getValue()}`) : '',
              },
              {
                id: 'dur',
                header: '持续',
                accessorFn: (row) =>
                  row.a.durationMs || (row.a.recoveredAt && row.a.firstAt ? row.a.recoveredAt - row.a.firstAt : 0),
                cell: (info) => {
                  const row = info.row.original
                  const dur = row.a.durationMs
                    ? `${Math.round(row.a.durationMs / 1000)}s`
                    : row.a.recoveredAt
                      ? `${Math.round((row.a.recoveredAt - row.a.firstAt) / 1000)}s`
                      : ''
                  return dur ? el('span', { className: 'dvb-tag' }, `持续${dur}`) : ''
                },
              },
              {
                id: 'ack',
                header: '确认',
                accessorFn: (row) => row.a.acknowledged,
                cell: (info) => {
                  const a = info.row.original.a
                  return a.acknowledged
                    ? `已确认·${a.ackedBy || 'user'}@${clockOf(a.ackedAt)}`
                    : a.suggestedBy
                      ? `建议·${a.suggestedBy}`
                      : '未确认'
                },
              },
              {
                id: 'ops',
                header: '',
                enableSorting: false,
                minSize: 180,
                accessorFn: (row) => row.a.id,
                cell: (info) => {
                  const row = info.row.original
                  return el(
                    'span',
                    { className: 'dvb-data-ops' },
                    !row.a.acknowledged
                      ? el(
                          'button',
                          {
                            type: 'button',
                            className: 'dvb-btn dvb-btn-sm',
                            onClick() {
                              doAck(row.a.id)
                            },
                          },
                          '确认',
                        )
                      : null,
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        title:
                          '复制告警结构化引用（稳定 ID+配置版本+时间范围，含 point/connection/device/frame/transaction/task）',
                        onClick() {
                          sendToAgentAlarm(row)
                        },
                      },
                      copiedAlarm === row.a.id ? '已复制' : '让 Agent 分析',
                    ),
                    row.pt
                      ? el(
                          'button',
                          {
                            type: 'button',
                            className: 'dvb-btn dvb-btn-sm',
                            onClick() {
                              jumpPoint(row)
                            },
                          },
                          '点位',
                        )
                      : null,
                    el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: jumpChart }, '曲线'),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        onClick() {
                          jumpFrames(row)
                        },
                      },
                      '报文',
                    ),
                  )
                },
              },
            ],
          })
        : el('div', { className: 'dvb-hint' }, t('alarmEmpty')),
      events.length
        ? el('div', { className: 'dvb-hint', style: { marginTop: '8px' } }, `历史事件 ${events.length}`)
        : null,
      events.length
        ? el(
            'div',
            { className: 'dvb-live-list' },
            events
              .slice(0, 6)
              .map((item) =>
                el(
                  'div',
                  { key: item.id, className: 'dvb-task', 'data-ok': item.ok ? 'true' : 'false' },
                  el('span', { className: 'dvb-map-meta' }, clockOf(item.at)),
                  el('span', { className: 'dvb-badge', 'data-source': item.source }, item.source),
                  el('span', { className: 'dvb-hint' }, item.summary),
                ),
              ),
          )
        : null,
    )
  }
}

// ── 操作记录（Task9/0.19.2）──────────────────────────────────────────────
// 时间线从"调试/上位机"移入侧边栏：筛选 + 每行 跳转/复制给Agent/查看报文。
