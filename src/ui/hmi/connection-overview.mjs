import { formatErrorMessage, renderModalDialog } from '../../../bench-shared.mjs'

/** All-connections management view. */
export function renderConnectionOverview(el, t, ctx) {
  const {
    cwd,
    sessionId,
    workspace,
    journal,
    pending,
    error,
    setError,
    modal,
    setModal,
    agentCopied,
    ioStatus,
    tabBar,
    focusToast,
    connListPanel,
    connFormPanel,
    statusBar,
    visionCollabBar,
  } = ctx

  const activeModal =
    modal ||
    (error
      ? {
          open: true,
          kind: 'err',
          title: '操作提示',
          message: formatErrorMessage(error),
          onClose: () => {
            if (typeof setModal === 'function') setModal(null)
            if (typeof setError === 'function') setError('')
          },
        }
      : null)

  return el(
    'div',
    { className: 'dvb-page' },
    statusBar(el, t, cwd, [
      { key: 'io', kind: ioStatus.kind, text: t('ioRuntimeShort') + ' · ' + t(ioStatus.labelKey) },
    ]),
    agentCopied
      ? el(
          'div',
          { className: 'dvb-msg', 'data-kind': 'ok' },
          agentCopied.split(':').pop() + ' · ' + agentCopied.split(':').slice(0, 2).join(':'),
        )
      : null,
    tabBar,
    focusToast,
    connListPanel,
    connFormPanel,
    renderModalDialog(el, t, activeModal),
  )
}
