import { connLabel } from '../../../bench-devices.mjs'

/** Connection tab bar (all / per-conn / overflow / add). */
export function renderConnectionTabs(el, t, ctx) {
  const {
    pack,
    pending,
    journal,
    activeConnId,
    connections,
    hmiTab,
    setHmiTab,
    moreOpen,
    setMoreOpen,
    selectConnection,
    findRtuOccupier,
    findTcpOccupier,
    cwd,
    addConnection,
  } = ctx
  void t
  function connEndpointLabel(c) {
    const cc = c?.conn || {}
    if (cc.mode === 'tcp') {
      if (c.role === 'server' || c.role === 'slave') return 'Listen :' + (cc.tcpPort || 502)
      return (cc.host || 'TCP') + ':' + (cc.tcpPort || 502)
    }
    return cc.port || '—'
  }
  function connTabLabel(c) {
    return c.name + ' · ' + connEndpointLabel(c)
  }
  function badgeForConn(connId) {
    const pts = (pack.points || []).filter((p) => (p.connectionId || p.connId) === connId)
    const ids = new Set(pts.map((p) => p.id))
    const anomaly = (pack.values || []).filter((v) => ids.has(v.key || v.pointId) && v.ok === false).length
    const pend = (pending || []).filter((r) => (r.connectionId || r.connId) === connId).length
    const running = (journal?.running ? journal.running.filter((x) => x && x.status === 'running') : []).length
    // Only show running badge on active connection to avoid clutter, but still compute
    return { anomaly, pend, running: connId === activeConnId ? running : 0 }
  }
  const MAX_VISIBLE_TABS = 6
  const visibleConns = connections.length > MAX_VISIBLE_TABS ? connections.slice(0, MAX_VISIBLE_TABS) : connections
  const overflowConns = connections.length > MAX_VISIBLE_TABS ? connections.slice(MAX_VISIBLE_TABS) : []
  function handleTabKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const order = ['all'].concat(connections.map((c) => c.id))
      const idx = order.indexOf(hmiTab)
      let nextIdx = idx
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % order.length
      if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + order.length) % order.length
      const nid = order[nextIdx]
      if (nid === 'all') setHmiTab('all')
      else selectConnection(nid)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setHmiTab('all')
    } else if (e.key === 'End') {
      e.preventDefault()
      const last = connections[connections.length - 1]
      if (last) selectConnection(last.id)
    }
  }
  const tabBar = el(
    'div',
    { className: 'dvb-hmi-tabs', role: 'tablist', onKeyDown: handleTabKeyDown },
    el(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': hmiTab === 'all' ? 'true' : 'false',
        className: 'dvb-tab' + (hmiTab === 'all' ? ' is-on' : ''),
        onClick() {
          setHmiTab('all')
          setMoreOpen(false)
        },
      },
      '全部连接',
    ),
    visibleConns.map((c) => {
      const isActive = hmiTab === c.id
      const b = badgeForConn(c.id)
      const occupied =
        c.conn && c.conn.mode === 'rtu' && c.conn.port
          ? findRtuOccupier(c.conn.port, c.id)
          : c.conn && c.conn.mode === 'tcp'
            ? findTcpOccupier(c.conn.host, c.conn.tcpPort, c.id)
            : null
      return el(
        'button',
        {
          key: c.id,
          type: 'button',
          role: 'tab',
          'aria-selected': isActive ? 'true' : 'false',
          className: 'dvb-tab' + (isActive ? ' is-on' : '') + (occupied ? ' is-warn' : ''),
          title: c.name + ' · ' + connLabel(c.conn || {}) + (occupied ? ' · COM冲突: ' + occupied : ''),
          onClick() {
            selectConnection(c.id)
          },
        },
        el('span', { className: 'dvb-tab-label' }, connTabLabel(c)),
        isActive
          ? el('span', {
              className: 'dvb-tab-dot',
              'data-kind': c.enabled === false ? 'idle' : pending.length ? 'warn' : 'live',
            })
          : null,
        b.anomaly || b.pend || b.running
          ? el(
              'span',
              { className: 'dvb-tab-badges' },
              b.anomaly ? el('span', { className: 'dvb-badge', 'data-kind': 'err' }, String(b.anomaly)) : null,
              b.running ? el('span', { className: 'dvb-badge', 'data-kind': 'live' }, String(b.running)) : null,
              b.pend ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, String(b.pend)) : null,
            )
          : null,
      )
    }),
    overflowConns.length
      ? el(
          'div',
          { className: 'dvb-tab-more' },
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-tab' + (overflowConns.some((c) => c.id === hmiTab) ? ' is-on' : ''),
              onClick() {
                setMoreOpen((v) => !v)
              },
            },
            '更多▼',
          ),
          moreOpen
            ? el(
                'div',
                { className: 'dvb-tab-dropdown' },
                overflowConns.map((c) => {
                  const isActive = hmiTab === c.id
                  const b = badgeForConn(c.id)
                  return el(
                    'button',
                    {
                      key: c.id,
                      type: 'button',
                      className: 'dvb-tab' + (isActive ? ' is-on' : ''),
                      onClick() {
                        selectConnection(c.id)
                        setMoreOpen(false)
                      },
                    },
                    el('span', null, connTabLabel(c)),
                    b.anomaly || b.pend || b.running
                      ? el(
                          'span',
                          { className: 'dvb-tab-badges' },
                          b.anomaly
                            ? el('span', { className: 'dvb-badge', 'data-kind': 'err' }, String(b.anomaly))
                            : null,
                          b.pend ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, String(b.pend)) : null,
                        )
                      : null,
                  )
                }),
              )
            : null,
        )
      : null,
    el(
      'button',
      {
        type: 'button',
        className: 'dvb-tab dvb-tab-add',
        title: '新建连接',
        disabled: !cwd,
        onClick: addConnection,
      },
      '+',
    ),
  )

  return tabBar
}
