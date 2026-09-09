import { connLabel } from '../../../bench-devices.mjs'
import { renderModalDialog, shouldHighlightFocus } from '../../../bench-shared.mjs'
import { renderConnectionThead } from './connection-thead.mjs'

/** Connection list / collection toolbar panel. */
export function renderConnectionPanel(el, t, ctx) {
  const {
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
      el('span', { className: 'dvb-panel-title' }, t('connBar') || '连接'),
      el('span', { className: 'dvb-tag' }, connections.length + ' 个连接'),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd,
          onClick: addConnection,
        },
        '＋连接',
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
        activeConnObj?.conn?.sim ? '切为真实' : '切为仿真',
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
                  c.role === 'server' || c.role === 'slave' ? t('roleSlave') || '从机' : t('roleMaster') || '主机'
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
                        title: isActive ? '当前连接' : '切换到此连接',
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
                      title: occupiedPort ? '已被 ' + occupiedPort + ' 占用' : '',
                    },
                    el(
                      'span',
                      null,
                      connLabel(c.conn || {}) + (occupiedPort ? ' · 已被 ' + occupiedPort + ' 占用' : ''),
                    ),
                    st !== 'disconnected'
                      ? el(
                          'span',
                          {
                            className: 'dvb-badge',
                            'data-kind': st === 'connected' ? 'live' : st === 'error' ? 'err' : 'warn',
                          },
                          st === 'connected'
                            ? t('connLive') || '已连接'
                            : st === 'connecting'
                              ? t('connConnecting') || '连接中'
                              : st === 'disconnecting'
                                ? t('connDisconnecting') || '断开中'
                                : st === 'error'
                                  ? t('connErr') || '连接异常'
                                  : '',
                        )
                      : null,
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
                          className: 'dvb-btn dvb-btn-primary',
                          disabled:
                            !cwd ||
                            !!linkBusy ||
                            !!c.conn?.sim ||
                            st === 'connecting' ||
                            st === 'disconnecting' ||
                            st === 'connected',
                          onClick() {
                            linkConnection(c.id)
                          },
                        },
                        st === 'connected'
                          ? t('connLive') || '已连接'
                          : st === 'connecting'
                            ? t('connConnecting') || '连接中'
                            : st === 'disconnecting'
                              ? t('connDisconnecting') || '断开中'
                              : st === 'error'
                                ? t('connRetry') || '重试连接'
                                : t('connLink') || '连接',
                      ),
                      st === 'connected'
                        ? el(
                            'button',
                            {
                              type: 'button',
                              className: 'dvb-btn',
                              disabled: !cwd || !!linkBusy,
                              onClick() {
                                unlinkConnection(c.id)
                              },
                            },
                            t('connUnlink') || '断开',
                          )
                        : null,
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn',
                          onClick() {
                            openConnEdit(c)
                          },
                        },
                        '编辑',
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm dvb-ai-btn',
                          title: '复制结构化引用（稳定 ID+配置版本）并让 Agent 分析',
                          'aria-label': '让 Agent 分析连接 ' + c.name,
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
                          title: connections.length <= 1 ? '至少保留一个连接' : '',
                          onClick() {
                            setPendingDeleteId(c.id)
                          },
                        },
                        t('removeDevice') || '删除',
                      ),
                    ),
                  ),
                )
              }),
            ),
          ),
        )
      : el('div', { className: 'dvb-empty' }, '暂无连接，点击「＋连接」创建'),
    deletingConn
      ? renderModalDialog(el, t, {
          open: true,
          kind: 'confirm',
          title: t('deleteConnConfirmTitle') || '删除连接',
          message: (
            t('deleteConnConfirmText') || '确定要删除连接“{name}”吗？此操作将移除该连接及其下关联的配置，不可撤销。'
          ).replace('{name}', deletingConn.name || deletingConn.id),
          cancelText: t('csvCancel') || '取消',
          confirmText: t('removeDevice') || '确认删除',
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
