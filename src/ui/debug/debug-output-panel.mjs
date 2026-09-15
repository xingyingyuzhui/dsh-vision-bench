/**
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {any} KeilBuildErrorList
 */
export function createDebugOutputPanel(React, t, KeilBuildErrorList) {
  const el = React.createElement

  return function DebugOutputPanel(props) {
    const { buildErrors, jumpToError, lastResult, openFullLog, buildOut } = props

    return el(
      'div',
      { className: 'dvb-panel dvb-panel-fill' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('outputLog')),
        buildErrors.length
          ? el('span', { className: 'dvb-badge', 'data-kind': 'err' }, `${buildErrors.length} 错误/警告`)
          : null,
        lastResult?.details && (lastResult.details.log_file || lastResult.details.logFile)
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                onClick: openFullLog,
              },
              '查看完整日志',
            )
          : null,
      ),
      el(KeilBuildErrorList, { buildErrors, jumpToError }),
      buildOut
        ? el('pre', { className: 'dvb-log' }, buildOut)
        : el('div', { className: 'dvb-empty' }, t('outputEmpty')),
    )
  }
}
