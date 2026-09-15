import { FLASH_INTERFACES, FLASH_TARGETS } from '../../domain/flash/openocd-profile.mjs'

/**
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {any} CustomSelect
 */
export function createDebugFlashPanel(React, t, CustomSelect) {
  const el = React.createElement

  function field(label, control) {
    return el(
      'div',
      { className: 'dvb-row' },
      el('div', { className: 'dvb-label' }, el('span', null, label)),
      control,
    )
  }

  return function DebugFlashPanel(props) {
    const {
      cwd,
      flash,
      setFlash,
      openocdFlash,
      artifactPath,
      probeOpenOcd,
      startFlash,
      approveFlash,
      cancelFlash,
    } = props

    const openocdReady = openocdFlash.status === 'ready'
    const flashReq = flash.confirm
    const showReprobe =
      !!openocdFlash.path &&
      (openocdFlash.status === 'failed' || openocdFlash.status === 'invalid' || openocdFlash.status === 'missing')
    const reprobeDisabled = openocdFlash.status === 'checking' || flash.busy

    return el(
      'div',
      { className: 'dvb-panel' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('flashTitle')),
        !openocdReady
          ? el(
              'span',
              { className: 'dvb-need' },
              openocdFlash.status === 'checking' ? t('openocdChecking') : openocdFlash.reason || t('needOpenocd'),
            )
          : null,
        showReprobe
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                disabled: reprobeDisabled,
                onClick() {
                  probeOpenOcd({ force: true })
                },
              },
              t('openocdReprobe'),
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-toolbar' },
        field(
          t('flashIface'),
          el(CustomSelect, {
            value: flash.interface,
            disabled: flash.busy,
            options: FLASH_INTERFACES.map((name) => ({ value: name, label: name })),
            onChange(val) {
              const value = val?.target ? val.target.value : val
              setFlash((prev) => ({ ...prev, interface: value }))
            },
          }),
        ),
        field(
          t('flashTarget'),
          el(CustomSelect, {
            value: flash.target,
            disabled: flash.busy,
            options: FLASH_TARGETS.map((name) => ({ value: name, label: name })),
            onChange(val) {
              const value = val?.target ? val.target.value : val
              setFlash((prev) => ({ ...prev, target: value }))
            },
          }),
        ),
      ),
      el(
        'div',
        { className: 'dvb-file' },
        el(
          'div',
          { className: 'dvb-path', 'data-empty': artifactPath ? '0' : '1' },
          artifactPath || t('flashNeedArtifact'),
        ),
      ),
      flashReq
        ? el(
            'div',
            { className: 'dvb-write-panel dvb-flash-confirm' },
            el('div', { className: 'dvb-write-title' }, t('flashConfirmTitle')),
            el('div', { className: 'dvb-hint' }, t('flashConfirmHint')),
            el('div', { className: 'dvb-cwd' }, `${flashReq.target} · ${flashReq.interface}\n${flashReq.file}`),
            el(
              'div',
              { className: 'dvb-hint' },
              `${Math.max(1, Math.round(flashReq.size / 1024))} KB${flashReq.sha256 ? ` · sha256 ${flashReq.sha256.slice(0, 16)}…` : ''}`,
            ),
            el(
              'div',
              { className: 'dvb-actions' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-primary dvb-btn-write',
                  disabled: flash.busy,
                  onClick: approveFlash,
                },
                flash.busy ? t('flashing') : t('flashApprove'),
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  disabled: flash.busy || flash.cancelBusy,
                  onClick: cancelFlash,
                },
                t('flashCancel'),
              ),
            ),
          )
        : el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-write',
              disabled: !cwd || openocdFlash.status !== 'ready' || !artifactPath || flash.busy,
              onClick: startFlash,
            },
            flash.busy ? t('flashing') : t('flashBtn'),
          ),
      flash.result
        ? el(
            'div',
            {
              className: 'dvb-msg',
              'data-kind': flash.result.ok ? 'ok' : 'err',
            },
            flash.result.summary || flash.result.error || (flash.result.ok ? t('flashDone') : t('flashFail')),
          )
        : null,
    )
  }
}
