import { connLabel } from '../../domain/modbus/connection-model.mjs'
import { shouldHighlightFocus } from '../common/focus-store.mjs'
import { renderConnectionThead } from './connection-thead.mjs'

/** Connection list / collection toolbar panel. */
export function renderConnectionPanel(el, t, ctx) {
  const {
    ModalDialog,
    focusState,
    connections,
    cwd,
    addConnection,
    activeConnObj,
    sim,
    activeConnId,
    toggleSim,
    watchEnabled,
    linkBusy,
    points,
    toggleCollection,
    polling,
    setPollingInterval,
    canDevice,
    connectionStates,
    selectConnection,
    findRtuOccupier,
    linkConnection,
    unlinkConnection,
    openConnEdit,
    sendToAgent,
    pendingDeleteId,
    setPendingDeleteId,
    requestDeleteConnection,
    connColWidths,
    onStartConnResize,
    resetConnColWidth,
    totalConnTableWidth,
  } = ctx
  const deletingConn = pendingDeleteId ? connections.find((c) => c.id === pendingDeleteId) : null
  return el(
    'div',
    {
      className:
        'dvb-conn-section' +
        (shouldHighlightFocus(focusState) && focusState.request.connectionId ? ' dvb-has-focus' : ''),
    },
    el(
      'div',
      { className: 'dvb-panel-head dvb-conn-section-head' },
      el('span', { className: 'dvb-panel-title' }, t('connBar')),
      el('span', { className: 'dvb-tag' }, t('connCount', { n: connections.length })),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd,
          onClick: addConnection,
        },
        t('connAdd'),
      ),
      activeConnObj?.conn?.sim ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, t('simOn')) : null,
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn',
          disabled: !cwd || !activeConnObj,
          onClick: toggleSim,
        },
        activeConnObj?.conn?.sim ? t('connUseReal') : t('connUseSim'),
      ),
    ),
    connections.length
      ? el(
          'div',
          { className: 'dvb-table-wrap' },
          el(
            'table',
            {
              className: 'dvb-table dvb-conn-table',
              style: {
                tableLayout: 'fixed',
                width: totalConnTableWidth ? `${totalConnTableWidth()}px` : '100%',
                minWidth: '100%',
              },
            },
            renderConnectionThead(el, t, {
              connColWidths,
              onStartResize: onStartConnResize,
              resetColWidth: resetConnColWidth,
            }),
            el(
              'tbody',
              null,
              connections.map((c) => {
                const isActive = c.id === activeConnId
                const roleLabel =
                  c.role === 'server' || c.role === 'slave' ? t('roleSlave') : t('roleMaster')
                const cm = connectionStates.find((x) => x.connectionId === c.id)
                const st = cm ? cm.status || 'disconnected' : 'disconnected'
                const occupiedPort =
                  c.conn && c.conn.mode === 'rtu' && c.conn.port ? findRtuOccupier(c.conn.port, c.id) : null
                return el(
                  'tr',
                  {
                    key: c.id,
                    'data-active': isActive ? 'true' : 'false',
                    style: isActive ? { background: 'var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1))' } : null,
                  },
                  el(
                    'td',
                    { className: 'dvb-col-name' },
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn' + (isActive ? ' is-on dvb-btn-primary' : ''),
                        title: isActive ? t('connCurrent') : t('connSwitch'),
                        onClick() {
                          selectConnection(c.id)
                        },
                      },
                      c.name,
                    ),
                  ),
                  el(
                    'td',
                    { className: 'dvb-col-role' },
                    el('span', { className: 'dvb-hint', title: roleLabel }, roleLabel),
                  ),
                  el(
                    'td',
                    {
                      className: 'dvb-col-endpoint',
                      title: occupiedPort ? t('connOccupied', { name: occupiedPort }) : '',
                    },
                    el(
                      'span',
                      { className: 'dvb-conn-endpoint' },
                      el('span', {
                        className: 'dvb-tab-dot',
                        'data-kind':
                          st === 'connected' ? 'live' : st === 'connecting' || st === 'disconnecting' ? 'warn' : 'err',
                        title:
                          st === 'connected'
                            ? t('connLive')
                            : st === 'connecting'
                              ? t('connConnecting')
                              : st === 'disconnecting'
                                ? t('connDisconnecting')
                                : st === 'error'
                                  ? t('connErr')
                                  : t('connIdle'),
                      }),
                      el(
                        'span',
                        { className: 'dvb-conn-endpoint-text' },
                        connLabel(c.conn || {}) + (occupiedPort ? t('connOccupiedSuffix', { name: occupiedPort }) : ''),
                      ),
                    ),
                  ),
                  el(
                    'td',
                    { className: 'dvb-col-actions' },
                    el(
                      'div',
                      { className: 'dvb-actions dvb-conn-actions' },
                      el(
                        'button',
                        {
                          type: 'button',
                          className:
                            st === 'connected' ? 'dvb-btn dvb-btn-danger' : 'dvb-btn dvb-btn-primary',
                          disabled:
                            !cwd ||
                            !!linkBusy ||
                            st === 'connecting' ||
                            st === 'disconnecting' ||
                            (st !== 'connected' && !!c.conn?.sim),
                          onClick() {
                            if (st === 'connected') unlinkConnection(c.id)
                            else linkConnection(c.id)
                          },
                        },
                        st === 'connected'
                          ? t('connUnlink')
                          : st === 'connecting'
                            ? t('connConnecting')
                            : st === 'disconnecting'
                              ? t('connDisconnecting')
                              : st === 'error'
                                ? t('connRetry')
                                : t('connLink'),
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn',
                          onClick() {
                            openConnEdit(c)
                          },
                        },
                        t('connEdit'),
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm dvb-ai-btn',
                          title: t('connAgentTitle'),
                          'aria-label': t('connAgentLabel', { name: c.name }),
                          onClick() {
                            sendToAgent('connection', { connectionId: c.id, name: c.name })
                          },
                        },
                        'AI',
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-danger-hover',
                          disabled: connections.length <= 1,
                          title: connections.length <= 1 ? t('connKeepOne') : '',
                          onClick() {
                            setPendingDeleteId(c.id)
                          },
                        },
                        t('removeDevice'),
                      ),
                    ),
                  ),
                )
              }),
            ),
          ),
        )
      : el('div', { className: 'dvb-empty' }, t('connEmpty')),
    deletingConn && ModalDialog
      ? el(ModalDialog, {
          open: true,
          kind: 'confirm',
          title: t('deleteConnConfirmTitle'),
          message: t('deleteConnConfirmText', { name: deletingConn.name || deletingConn.id }),
          cancelText: t('csvCancel'),
          confirmText: t('removeDevice'),
          danger: true,
          onCancel() {
            setPendingDeleteId('')
          },
          onConfirm() {
            requestDeleteConnection(deletingConn.id)
          },
        })
      : null,
  )
}
