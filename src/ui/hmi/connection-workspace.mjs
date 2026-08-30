/** Single-connection workspace: devices, points, pending writes. */
export function renderConnectionWorkspace(el, t, ctx) {
  const {
    cwd,
    sessionId,
    workspace,
    journal,
    pending,
    error,
    agentCopied,
    ioStatus,
    tabBar,
    focusToast,
    devFormPanel,
    deviceCardsPanel,
    pendingPanel,
    statusBar,
    visionCollabBar,
  } = ctx
  return el(
    'div',
    { className: 'dvb-page' },
    statusBar(el, t, cwd, [
      { key: 'io', kind: ioStatus.kind, text: t('ioRuntimeShort') + ' · ' + t(ioStatus.labelKey) },
    ]),
    visionCollabBar(el, t, { cwd, workspace, journal, pendingWrites: pending, sessionId }),
    error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
    agentCopied
      ? el(
          'div',
          { className: 'dvb-msg', 'data-kind': 'ok' },
          agentCopied.split(':').pop() + ' · ' + agentCopied.split(':').slice(0, 2).join(':'),
        )
      : null,
    tabBar,
    focusToast,
    devFormPanel,
    deviceCardsPanel,
    pendingPanel,
  )
}
