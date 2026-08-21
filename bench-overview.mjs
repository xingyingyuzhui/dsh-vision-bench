import { NS } from './bench-i18n.mjs'
import { clockOf } from './bench-points.mjs'
import { subscribeState } from './bench-shared.mjs'
import { statusKind } from './bench-settings.mjs'

function overviewEmptyWorkspace() {
  return {
    keil: { project: '', target: '', artifact: 'hex', download: '' },
    tasks: [],
    timeline: [],
    session: { boundId: '' },
    manualRequests: [],
    modbus: {},
  }
}

function overviewSourceLabel(t, source) {
  if (source === 'agent') return t('sourceAgent')
  if (source === 'system') return t('sourceSystem')
  return t('sourceUser')
}

export function createOverviewView(React, t, post, hooks) {
  return function OverviewView(props) {
    const el = React.createElement
    const cwd = props && props.sessionId && props.useSessions
      ? props.useSessions((s) => {
        const id = props.sessionId
        return (s && s.byId && id && s.byId[id] && s.byId[id].cwd) || ''
      })
      : ''
    const [health, setHealth] = React.useState({})
    const [workspace, setWorkspace] = React.useState(overviewEmptyWorkspace)
    const [pendingWrites, setPendingWrites] = React.useState([])
    const [copied, setCopied] = React.useState(false)

    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (!data) return
      if (data.health) setHealth(data.health)
      if (Array.isArray(data.pendingWrites)) setPendingWrites(data.pendingWrites)
      if (data.workspace) setWorkspace(data.workspace)
    }), [cwd, post])

    const keil = workspace.keil || {}
    const modbus = workspace.modbus || {}
    const devices = Array.isArray(modbus.devices) ? modbus.devices : []
    const session = workspace.session || {}
    const boundId = session.boundId || ''
    const sessionId = (props && props.sessionId) || ''
    const bindState = !sessionId
      ? 'none'
      : (boundId === sessionId ? 'self' : (boundId ? 'other' : 'open'))
    const openManual = (workspace.manualRequests || []).filter((item) => item.status === 'pending')
    const lastBuild = (workspace.tasks || []).find((item) => item.type === 'build')
    const timeline = (workspace.timeline || []).slice(0, 8)

    function copySnapshot() {
      const lines = [
        '[台架快照] ' + clockOf(Date.now()),
        '工作区: ' + (cwd || '（无）'),
        '工程: ' + (keil.project || '（未选）') + (keil.target ? ' · Target ' + keil.target : ''),
        '产物: ' + (keil.download || '（无）'),
        '最近编译: ' + (lastBuild ? lastBuild.summary + '（' + lastBuild.status + '）' : '（无记录）'),
        '设备: ' + (devices.length
          ? devices.map((item) => (item.name || item.id)
            + '（' + (item.role === 'slave' ? '从机' : '主机')
            + (item.sim ? '·仿真' : '')
            + (item.listen ? '·监听' : '')
            + (item.polling && item.polling.enabled ? '·监视中' : '') + '）').join('， ')
          : '（无）'),
        '会话绑定: ' + (bindState === 'self' ? '本会话' : bindState === 'other' ? '其他会话' : '未绑定'),
        '待办: Agent 写点确认 ' + pendingWrites.length + ' 项，人工操作 ' + openManual.length + ' 项',
      ]
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function field(label, node) {
      return el('div', { className: 'dvb-row' },
        el('div', { className: 'dvb-label' }, el('span', null, label)),
        node)
    }

    const rows = [
      { key: 'python', health: health.python },
      { key: 'uv4', health: health.uv4 },
      { key: 'openocd', health: health.openocd },
    ]

    return el('div', { className: 'dvb-page' },
      el('div', { className: 'dvb-bar' },
        el('div', { className: 'dvb-health' }, rows.map((row) => el('span', {
          key: row.key,
          className: 'dvb-chip',
          'data-kind': statusKind(row.health),
        }, t(row.key) + ' · ' + t(statusKind(row.health))))),
        cwd
          ? el('div', { className: 'dvb-cwd' }, t('workspace') + '  ' + cwd)
          : el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('needWorkspace'))),
      el('div', { className: 'dvb-split' },
        el('div', { className: 'dvb-panel' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('ovProject'))),
          field(t('project'), el('div', { className: 'dvb-path', 'data-empty': keil.project ? '0' : '1' },
            keil.project || t('pickProject'))),
          field(t('target'), el('div', { className: 'dvb-path', 'data-empty': keil.target ? '0' : '1' },
            keil.target || '—')),
          field(t('artifact'), el('div', { className: 'dvb-path', 'data-empty': keil.download ? '0' : '1' },
            keil.download || '—')),
          field(t('ovLastBuild'), el('div', { className: 'dvb-status', 'data-kind': lastBuild ? (lastBuild.status === 'ok' ? 'ready' : 'missing') : '' },
            lastBuild ? lastBuild.summary : t('ovNoBuild')))),
        el('div', { className: 'dvb-panel' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('ovLive'))),
          field(t('ovDevices'), el('div', { className: 'dvb-path' },
            devices.length
              ? devices.map((item) => (item.name || item.id)
                + '（' + (item.role === 'slave' ? t('roleSlave') : t('roleMaster'))
                + (item.sim ? ' · ' + t('sim') : '')
                + (item.listen ? ' · ' + t('listen') : '')
                + (item.polling && item.polling.enabled ? ' · ' + t('live') : '') + '）').join('， ')
              : t('emptyDevices'))),
          field(t('bindChip'), el('span', {
            className: 'dvb-chip',
            'data-kind': bindState === 'self' ? 'ready' : 'unbound',
          }, t('bindState_' + bindState))),
          field(t('ovTodo'), el('div', { className: 'dvb-path' },
            t('ovTodoLine')
              .replace('{writes}', String(pendingWrites.length))
              .replace('{manual}', String(openManual.length)))))),
      el('div', { className: 'dvb-actions' },
        el('button', {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd,
          onClick: copySnapshot,
        }, copied ? t('copied') : t('copyAgent')),
        hooks && typeof hooks.openLive === 'function'
          ? el('button', {
            type: 'button', className: 'dvb-btn',
            onClick() { hooks.openLive() },
          }, t('liveTable'))
          : null),
      timeline.length
        ? el('div', { className: 'dvb-journal' },
          el('div', { className: 'dvb-journal-title' }, t('timeline')),
          timeline.map((item) => el('div', { key: item.id, className: 'dvb-event', 'data-ok': item.ok === false ? 'false' : '' },
            el('span', { className: 'dvb-map-meta' }, clockOf(item.at)),
            el('span', { className: 'dvb-badge', 'data-source': item.source }, overviewSourceLabel(t, item.source)),
            el('span', { className: 'dvb-hint' }, item.summary || item.kind))))
        : null)
  }
}

export function registerOverview(ctx, React, t, OverviewPage) {
  const slots = ctx.get ? ctx.get('slots') : ctx.slots
  if (slots == null || React == null) return function () {}
  const stop = slots.inject('conversation.view', function () {
    return slots.register({
      name: 'conversation.view',
      id: 'vision-bench-overview',
      order: 19,
      locale: NS,
      label() { return t('tabOverview') },
    }, OverviewPage)
  })
  return function () {
    if (typeof stop === 'function') stop()
  }
}
