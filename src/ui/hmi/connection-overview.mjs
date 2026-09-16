import { formatErrorMessage } from '../common/ui-format.mjs'

/** All-connections management view. */
export function renderConnectionOverview(el, t, ctx) {
  const {
    ModalDialog,
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
    activeModal && ModalDialog ? el(ModalDialog, activeModal) : null,
  )
}
