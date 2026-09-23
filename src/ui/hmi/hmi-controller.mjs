/** Shared HMI field wrapper. */
export function renderField(el, t, ctx) {
  void t
  const { label, control } = ctx
  return el('div', { className: 'dvb-row' }, el('div', { className: 'dvb-label' }, el('span', null, label)), control)
}

/** RTU port occupancy label among connections. */
export function rtuOccupierAmong(connections, port, excludeId) {
  if (!port) return null
  const key = String(port).trim().toLowerCase()
  const hit = connections.find(
    (c) =>
      c.id !== excludeId &&
      c.enabled !== false &&
      c.conn &&
      c.conn.mode === 'rtu' &&
      String(c.conn.port || '')
        .trim()
        .toLowerCase() === key,
  )
  return hit ? hit.name : null
}

/** TCP host:port occupancy label among connections. */
export function tcpOccupierAmong(connections, host, tcpPort, excludeId) {
  const key =
    String(host || '')
      .trim()
      .toLowerCase() +
    ':' +
    String(tcpPort || 502)
  const hit = connections.find((c) => {
    if (c.id === excludeId || c.enabled === false) return false
    const cc = c.conn || {}
    if (cc.mode !== 'tcp') return false
    const k =
      String(cc.host || '')
        .trim()
        .toLowerCase() +
      ':' +
      String(cc.tcpPort || 502)
    return k === key
  })
  return hit ? hit.name : null
}

/** Transient Agent focus toast (.dvb-focus-toast disabled per user request: do not display bottom-right popup). */
export function renderFocusToast(el, t, ctx) {
  void el
  void t
  void ctx
  return null
}

/** Pending agent write approvals. */
export function renderPendingPanel(el, t, ctx) {
  const { pending, resolveWrite, resolvingId = '' } = ctx
  if (!pending.length) return null
  const busy = Boolean(resolvingId)
  return el(
    'div',
    {
      className: 'dvb-panel dvb-write-panel',
      'aria-live': 'polite',
      'aria-busy': busy ? 'true' : undefined,
    },
    el('div', { className: 'dvb-panel-head' }, el('span', { className: 'dvb-panel-title' }, t('pendingWrites'))),
    ...pending.map((req) => {
      const requestLabel = String(req.label || '')
      return el(
        'div',
        { key: req.id, className: 'dvb-task' },
        el('span', { className: 'dvb-badge', 'data-source': 'agent' }, 'Agent'),
        el(
          'span',
          { className: 'dvb-hint' },
          requestLabel +
            (req.deviceName ? ' · ' + req.deviceName : '') +
            (req.endpointLabelStr ? ' · ' + req.endpointLabelStr : ''),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
            disabled: busy,
            'aria-label': `${t('approveWrite')} ${requestLabel}`.trim(),
            onClick() {
              resolveWrite(req.id, true)
            },
          },
          t('approveWrite'),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            disabled: busy,
            'aria-label': `${t('rejectWrite')} ${requestLabel}`.trim(),
            onClick() {
              resolveWrite(req.id, false)
            },
          },
          t('rejectWrite'),
        ),
      )
    }),
  )
}
