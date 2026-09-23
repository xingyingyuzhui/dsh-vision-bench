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
    let statusColor = 'var(--dsw-alias-label-tertiary, #888)'
    let statusText = t('dbgIdle')
    if (pendingControl === 'starting' || status === 'starting') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = t('dbgStarting')
    } else if (pendingControl === 'pausing') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = t('dbgPausing')
    } else if (pendingControl === 'stepping') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = t('dbgStepping')
    } else if (pendingControl === 'resetting') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = t('dbgResetting')
    } else if (pendingControl === 'stopping') {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = t('dbgStopping')
    } else if (isRunning) {
      statusColor = 'var(--dsw-alias-label-success, #2e7d32)'
      statusText = t('dbgRunning')
    } else if (isPaused) {
      statusColor = 'var(--dsw-alias-label-warning, #f59e0b)'
      statusText = t('dbgPaused')
    } else if (isFailed) {
      statusColor = 'var(--dsw-alias-label-danger, #c62828)'
      statusText = t('dbgFailed')
    }

    const filePart = location?.file ? String(location.file).split(/[\\/]/).pop() : ''
    const locShort = filePart ? `${filePart}${location.line ? `:${location.line}` : ''}` : location?.address || ''
    const locText = isPaused && locShort ? t('dbgHit', { loc: locShort }) : locShort || null

    return el(
      'div',
      { className: 'dvb-debug-toolbar' },
      el(
        'div',
        { className: 'dvb-debug-status-group' },
        el(
          'span',
          {
            className: 'dvb-debug-status-chip',
            style: { color: statusColor },
          },
          statusText,
        ),
        locText ? el('span', { className: 'dvb-debug-status-sep' }, '|') : null,
        locText ? el('span', { className: 'dvb-debug-loc-text' }, locText) : null,
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
              isStarting ? t('dbgStarting') : t('dbgStart'),
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
              t('dbgContinue'),
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
              t('dbgPause'),
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: t('dbgStepOver'),
                disabled: isBusy,
                onClick: () => onStep && onStep('over'),
              },
              t('dbgStepOver'),
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: t('dbgStepInto'),
                disabled: isBusy,
                onClick: () => onStep && onStep('into'),
              },
              t('dbgStepInto'),
            )
          : null,
        isPaused
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: t('dbgStepOut'),
                disabled: isBusy,
                onClick: () => onStep && onStep('out'),
              },
              t('dbgStepOut'),
            )
          : null,
        !isIdle
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-debug-stop-btn',
                disabled: isBusy,
                onClick: () => onStop && onStop(),
              },
              t('dbgStop'),
            )
          : null,
      ),
    )
  }
}
