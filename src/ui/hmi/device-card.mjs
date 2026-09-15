import { connTabLabel } from './connection-label.mjs'
import { renderDeviceCard } from './device-card-item.mjs'

/** Device cards panel with nested point tables. */
export function renderDeviceCards(el, t, ctx) {
  const {
    activeConnObj,
    activeDevices,
    points,
    cwd,
    activeConnId,
    openAddDevice,
    linkConnection,
    unlinkConnection,
    linkBusy,
    connectionStates,
  } = ctx

  const activeCm = (connectionStates || []).find((x) => x.connectionId === activeConnId)
  const activeLinkSt = activeCm ? activeCm.status || 'disconnected' : 'disconnected'
  const isConnected = activeLinkSt === 'connected'
  const isSimulated = Boolean(activeCm?.simulated || activeConnObj?.conn?.sim || activeConnObj?.sim)
  const isBusy =
    activeLinkSt === 'connecting' ||
    activeLinkSt === 'disconnecting' ||
    linkBusy === activeConnId ||
    linkBusy === 'poll'

  return el(
    'div',
    { className: 'dvb-dev-section' },
    el(
      'div',
      { className: 'dvb-panel-head dvb-dev-section-head' },
      el('span', { className: 'dvb-panel-title' }, connTabLabel(activeConnObj)),
      isSimulated ? el('span', { className: 'dvb-badge', 'data-kind': 'live' }, '仿真') : null,
      el(
        'span',
        { className: 'dvb-tag' },
        (activeDevices || []).length + ' 个设备 · ' + (points || []).length + ' 个点位',
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd || !activeConnId,
          onClick: openAddDevice,
        },
        '＋添加设备',
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn' + (isConnected ? ' dvb-btn-danger-hover' : ' dvb-btn-primary'),
          disabled: !cwd || !activeConnId || isBusy,
          onClick() {
            if (isConnected) {
              if (typeof unlinkConnection === 'function') unlinkConnection(activeConnId)
            } else {
              if (typeof linkConnection === 'function') linkConnection(activeConnId)
            }
          },
        },
        isBusy
          ? activeLinkSt === 'connecting'
            ? '连接中…'
            : activeLinkSt === 'disconnecting'
              ? '断开中…'
              : '处理中…'
          : isConnected
            ? isSimulated
              ? '断开仿真'
              : t('connUnlink') || '断开'
            : activeLinkSt === 'error'
              ? t('connRetry') || '重试连接'
              : isSimulated
                ? '启动仿真'
                : t('connLink') || '连接',
      ),
    ),
    activeDevices.length
      ? el(
          'div',
          { className: 'dvb-dev-cards' },
          activeDevices.map((d) => renderDeviceCard(el, t, { device: d, ctx, isSimulated })),
        )
      : el(
          'div',
          { className: 'dvb-empty dvb-dev-empty' },
          el('div', { className: 'dvb-dev-empty-title' }, '连接已创建'),
          el('div', { className: 'dvb-hint' }, '下一步：添加设备'),
          el(
            'button',
            { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: openAddDevice },
            '＋添加设备',
          ),
        ),
  )
}
