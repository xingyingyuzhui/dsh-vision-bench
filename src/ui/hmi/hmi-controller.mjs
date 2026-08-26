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

/** Transient Agent focus toast. */
export function renderFocusToast(el, t, ctx) {
  void t
  const { focusState, returnToPrevFocus, setFocusUi } = ctx
  if (!(focusState?.request && !focusState.badgeOnly)) return null
  return el(
    'div',
    { className: 'dvb-focus-toast', role: 'status' },
    el(
      'span',
      null,
      'Agent 已定位到 ' +
        [
          focusState.request.connectionId,
          focusState.request.deviceId,
          focusState.request.pointId || focusState.request.frameId,
        ]
          .filter(Boolean)
          .join(' / '),
    ),
    focusState.prev
      ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: returnToPrevFocus }, '返回原位置')
      : null,
    el(
      'button',
      {
        type: 'button',
        className: 'dvb-btn dvb-btn-sm',
        onClick() {
          setFocusUi({
            request: null,
            prev: focusState?.request,
            tempWatchIds: [],
            badgeOnly: false,
            evidence: [],
          })
        },
      },
      '×',
    ),
  )
}

/** Pending agent write approvals. */
export function renderPendingPanel(el, t, ctx) {
  const { pending, resolveWrite } = ctx
  if (!pending.length) return null
  return el(
    'div',
    { className: 'dvb-panel dvb-write-panel' },
    el('div', { className: 'dvb-panel-head' }, el('span', { className: 'dvb-panel-title' }, t('pendingWrites'))),
    ...pending.map((req) =>
      el(
        'div',
        { key: req.id, className: 'dvb-task' },
        el('span', { className: 'dvb-badge', 'data-source': 'agent' }, 'Agent'),
        el(
          'span',
          { className: 'dvb-hint' },
          req.label +
            (req.deviceName ? ' · ' + req.deviceName : '') +
            (req.endpointLabelStr ? ' · ' + req.endpointLabelStr : ''),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
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
            onClick() {
              resolveWrite(req.id, false)
            },
          },
          t('rejectWrite'),
        ),
      ),
    ),
  )
}

/** Config draft list (RFC6902). */
export function renderDraftPanel(el, t, ctx) {
  const { workspace, normalizePack, draftBusy, draftNote, cwd, resolveDraft } = ctx
  const draftList = (workspace.configDrafts || []).filter((d) => d?.id)
  const pendingDrafts = draftList.filter((d) => d.status === 'pending')
  const currentCfgVersion = normalizePack().configVersion || 1
  return el(
    'div',
    { className: 'dvb-panel' },
    el(
      'div',
      { className: 'dvb-panel-head' },
      el('span', { className: 'dvb-panel-title' }, t('draftTitle')),
      el(
        'span',
        { className: 'dvb-tag' },
        (pendingDrafts.length ? pendingDrafts.length + ' 待确认' : t('draftEmpty')) + ' · v' + currentCfgVersion,
      ),
      pendingDrafts.length ? el('span', { className: 'dvb-hint' }, t('draftApproveHint')) : null,
    ),
    draftList.length
      ? el(
          'div',
          { className: 'dvb-live-list' },
          draftList.slice(0, 8).map((d) => {
            const s = d.summary || {}
            const isPending = d.status === 'pending'
            const busyApply = draftBusy === d.id + ':apply'
            const busyDiscard = draftBusy === d.id + ':discard'
            const drift = !isPending && d.status !== 'applied' ? false : currentCfgVersion !== d.baseConfigVersion
            return el(
              'div',
              {
                key: d.id,
                className: 'dvb-task',
                'data-status': d.status,
                style: drift ? { borderLeft: '3px solid #e0912f', paddingLeft: '6px' } : null,
              },
              el(
                'span',
                { className: 'dvb-badge', 'data-kind': isPending ? 'warn' : d.status === 'applied' ? 'ok' : 'idle' },
                d.status === 'pending' ? '待确认' : d.status === 'applied' ? t('draftApplied') : t('draftDiscarded'),
              ),
              el('span', { className: 'dvb-hint', title: d.id }, d.id.slice(0, 12) + '…'),
              el('span', { className: 'dvb-tag' }, t('draftBaseVersion') + ' v' + d.baseConfigVersion),
              el('span', { className: 'dvb-tag' }, (s.patchCount || d.patch.length) + ' ' + t('draftPatchCount')),
              el('span', { className: 'dvb-tag' }, t('draftAffectedPoints') + ' ' + (s.affectedPoints || 0)),
              el(
                'span',
                { className: 'dvb-chip', 'data-kind': s.added || 0 ? 'ready' : 'idle' },
                t('draftAdded') + ' ' + (s.added || 0),
              ),
              el(
                'span',
                { className: 'dvb-chip', 'data-kind': s.removed || 0 ? 'err' : 'idle' },
                t('draftRemoved') + ' ' + (s.removed || 0),
              ),
              el(
                'span',
                { className: 'dvb-chip', 'data-kind': s.modified || 0 ? 'live' : 'idle' },
                t('draftModified') + ' ' + (s.modified || 0),
              ),
              s.comConflicts?.length
                ? el('span', { className: 'dvb-need' }, t('draftComConflict') + ': ' + s.comConflicts.join('；'))
                : null,
              s.unitIdConflicts?.length
                ? el('span', { className: 'dvb-need' }, t('draftUnitConflict') + ': ' + s.unitIdConflicts.join('；'))
                : null,
              s.details?.length
                ? el(
                    'div',
                    {
                      className: 'dvb-hint',
                      title: s.details.map((x) => x.op + ' ' + x.path).join('\n'),
                      style: { maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    },
                    t('draftDetails') +
                      ': ' +
                      s.details
                        .slice(0, 3)
                        .map((x) => x.op + ' ' + x.path)
                        .join('；') +
                      (s.details.length > 3 ? ' …' : ''),
                  )
                : null,
              drift && isPending ? el('span', { className: 'dvb-need' }, t('draftDrift')) : null,
              isPending
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-primary dvb-btn-write',
                      disabled: busyApply || busyDiscard || !cwd,
                      onClick() {
                        resolveDraft(d.id, 'apply')
                      },
                      title: t('draftApproveHint'),
                    },
                    busyApply ? t('draftApplying') : t('draftApprove'),
                  )
                : null,
              isPending
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn',
                      disabled: busyApply || busyDiscard,
                      onClick() {
                        resolveDraft(d.id, 'discard')
                      },
                    },
                    busyDiscard ? '...' : t('draftDiscard'),
                  )
                : null,
            )
          }),
        )
      : el('div', { className: 'dvb-empty' }, t('draftEmpty')),
    draftNote
      ? el(
          'div',
          {
            className: 'dvb-msg',
            'data-kind': draftNote.indexOf('漂移') >= 0 || draftNote.indexOf('CONFIG_DRIFT') >= 0 ? 'err' : 'ok',
          },
          draftNote,
        )
      : null,
  )
}
