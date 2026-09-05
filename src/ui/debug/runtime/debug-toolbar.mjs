// @ts-check

/**
 * Debug control toolbar with strict state-driven action availability.
 * Parity with Phase 7 Section 11.6.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createDebugToolbar(React, t) {
  const el = React.createElement

  return function DebugToolbar({
    status = 'idle',
    pendingControl = null,
    backend = 'gdb-openocd',
    target = '',
    location = null,
    loading = false,
    onStart,
    onStop,
    onRun,
    onPause,
    onStep,
    onReset,
    onRefresh,
  }) {
    const isBusy = Boolean(loading || pendingControl)
    const isIdle = status === 'idle' || status === 'stopped'
    const isStarting = status === 'starting' || pendingControl === 'starting'
    const isRunning = status === 'running' && !pendingControl
    const isPaused = status === 'paused' && !pendingControl
    const isFailed = status === 'failed' && !pendingControl

    // Status chip color
    let statusColor = 'var(--dsw-alias-label-muted, #888)'
    let statusText = '空闲'
    if (pendingControl === 'starting' || status === 'starting') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = '正在启动…'
    } else if (pendingControl === 'pausing') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = '正在暂停…'
    } else if (pendingControl === 'stepping') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = '正在单步…'
    } else if (pendingControl === 'resetting') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = '正在复位…'
    } else if (pendingControl === 'stopping') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = '正在停止…'
    } else if (isRunning) {
      statusColor = 'var(--dsw-alias-label-success, #2e7d32)'
      statusText = '运行中'
    } else if (isPaused) {
      statusColor = 'var(--dsw-alias-label-info, #4f8ef7)'
      statusText = '已暂停'
    } else if (isFailed) {
      statusColor = 'var(--dsw-alias-label-danger, #c62828)'
      statusText = '异常中断'
    }

    const locText =
      location && (location.file || location.address)
        ? `${location.file ? location.file.split(/[\\/]/).pop() : ''}${location.line ? `:${location.line}` : ''}${
            location.function ? ` (${location.function})` : ''
          }${location.address ? ` @ ${location.address}` : ''}`
        : null

    return el(
      'div',
      { className: 'dvb-debug-toolbar' },
      el(
        'div',
        { className: 'dvb-debug-status-group' },
        el(
          'span',
          {
            className: 'dvb-chip',
            style: { fontWeight: 600, color: statusColor, borderColor: statusColor },
          },
          statusText,
        ),
        backend ? el('span', { className: 'dvb-chip' }, backend) : null,
        target ? el('span', { className: 'dvb-chip' }, target) : null,
        locText
          ? el(
              'span',
              {
                className: 'dvb-chip',
                style: { fontFamily: 'ui-monospace, monospace', opacity: 0.9 },
              },
              locText,
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-debug-btn-group' },
        isIdle || isFailed
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                disabled: isBusy,
                onClick: () => onStart && onStart(),
              },
              isStarting ? '启动中…' : '▶ 启动调试',
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                disabled: isBusy,
                onClick: () => onRun && onRun(),
              },
              '▶ 继续',
            )
          : null,
        isRunning
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                disabled: isBusy,
                onClick: () => onPause && onPause(),
              },
              '⏸ 暂停',
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: '单步跳过 (Step Over)',
                disabled: isBusy,
                onClick: () => onStep && onStep('over'),
              },
              '↷ 单步跳过',
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: '单步进入 (Step Into)',
                disabled: isBusy,
                onClick: () => onStep && onStep('into'),
              },
              '↓ 进入',
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: '单步跳出 (Step Out)',
                disabled: isBusy,
                onClick: () => onStep && onStep('out'),
              },
              '↑ 跳出',
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: '复位并暂停 (Reset & Halt)',
                disabled: isBusy,
                onClick: () => onReset && onReset(),
              },
              '↺ 复位',
            )
          : null,
        !isIdle
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
                disabled: isBusy,
                onClick: () => onStop && onStop(),
              },
              '⏹ 停止',
            )
          : null,
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm',
            title: '刷新调试状态',
            disabled: isBusy,
            onClick: () => onRefresh && onRefresh(),
          },
          '刷新',
        ),
      ),
    )
  }
}
