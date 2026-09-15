/**
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {any} CustomSelect
 */
export function createDebugProjectPanel(React, t, CustomSelect) {
  const el = React.createElement

  function field(label, control) {
    return el(
      'div',
      { className: 'dvb-row' },
      el('div', { className: 'dvb-label' }, el('span', null, label)),
      control,
    )
  }

  return function DebugProjectPanel(props) {
    const {
      cwd,
      workspace,
      targets,
      busy,
      pythonReady,
      uv4Ready,
      buildBusy,
      buildLabel,
      buildBlock,
      lastResult,
      copied,
      openPicker,
      openProject,
      setKeil,
      persist,
      build,
      copyForAgent,
    } = props

    return el(
      'div',
      { className: 'dvb-panel' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('project')),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            disabled: !cwd || !!busy,
            onClick() {
              openPicker(cwd)
            },
          },
          busy === 'picker' ? t('opening') : t('browse'),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            disabled: !cwd || !workspace.keil.project,
            onClick() {
              if (typeof openProject === 'function') openProject()
            },
          },
          t('mapOpen'),
        ),
      ),
      el(
        'div',
        { className: 'dvb-file' },
        el(
          'div',
          { className: 'dvb-path', 'data-empty': workspace.keil.project ? '0' : '1' },
          workspace.keil.project || t('pickProject'),
        ),
      ),
      el(
        'div',
        { className: 'dvb-toolbar' },
        field(
          t('target'),
          el(CustomSelect, {
            value: workspace.keil.target,
            disabled: !workspace.keil.project || busy === 'targets',
            options: [{ value: '', label: t('pickTarget') }].concat(
              targets.map((item) => ({ value: item.name, label: item.name })),
            ),
            onChange(val) {
              const target = val?.target ? val.target.value : val
              setKeil({ target })
              persist({ ...workspace, keil: { ...workspace.keil, target } })
            },
          }),
        ),
        field(
          t('artifact'),
          el(CustomSelect, {
            value: workspace.keil.artifact || 'hex',
            disabled: !workspace.keil.project,
            options: [
              { value: 'hex', label: '.hex' },
              { value: 'bin', label: '.bin' },
              { value: 'axf', label: '.axf' },
              { value: 'elf', label: '.elf' },
            ],
            onChange(val) {
              const artifact = val?.target ? val.target.value : val
              setKeil({ artifact })
              persist({ ...workspace, keil: { ...workspace.keil, artifact } })
            },
          }),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary',
            disabled: !cwd || !pythonReady || !uv4Ready || !workspace.keil.project || buildBusy,
            onClick: build,
          },
          buildLabel,
        ),
        lastResult
          ? el(
              'button',
              { type: 'button', className: 'dvb-btn', onClick: copyForAgent },
              copied ? t('copied') : t('copyAgent'),
            )
          : null,
        !buildBusy && buildBlock ? el('span', { className: 'dvb-need' }, buildBlock) : null,
      ),
    )
  }
}
