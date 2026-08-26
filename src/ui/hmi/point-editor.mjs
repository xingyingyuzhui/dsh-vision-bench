import { fnOptionLabel } from './hmi-ids.mjs'
import { renderFlagSwitch } from './point-flags.mjs'

/** New-point draft row inside a device table. */
export function renderNewPointRow(el, t, ctx) {
  const { newPointDraft, setNewPointDraft, cwd, saveNewPointDraft } = ctx
  return el(
    'tr',
    { className: 'dvb-pt-row dvb-newpoint-row', 'data-editing': 'true' },
    el(
      'td',
      { className: 'dvb-col-name' },
      el('input', {
        className: 'dvb-input',
        placeholder: t('ptNamePh'),
        value: newPointDraft.name,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, name: e.target.value })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-fn' },
      el(
        'select',
        {
          className: 'dvb-input',
          value: String(newPointDraft.function),
          onChange: (e) => setNewPointDraft((prev) => ({ ...prev, function: Number(e.target.value) })),
        },
        el('option', { value: '1' }, fnOptionLabel(t, 1)),
        el('option', { value: '2' }, fnOptionLabel(t, 2)),
        el('option', { value: '3' }, fnOptionLabel(t, 3)),
        el('option', { value: '4' }, fnOptionLabel(t, 4)),
      ),
    ),
    el(
      'td',
      { className: 'dvb-col-addr' },
      el('input', {
        className: 'dvb-input dvb-input-mono',
        type: 'number',
        min: 0,
        max: 65535,
        value: newPointDraft.address,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, address: Number(e.target.value) })),
      }),
    ),
    el('td', { className: 'dvb-col-value' }, '—'),
    el(
      'td',
      { className: 'dvb-col-monitor' },
      renderFlagSwitch(el, t, {
        checked: newPointDraft.monitorEnabled === true,
        title: '开启后成为可视化数据源',
        onToggle: (next) => setNewPointDraft((prev) => ({ ...prev, monitorEnabled: next })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-alarm' },
      renderFlagSwitch(el, t, {
        checked: newPointDraft.alarmEnabled === true,
        title: '参与告警判断',
        onToggle: (next) => setNewPointDraft((prev) => ({ ...prev, alarmEnabled: next })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-scale' },
      el('input', {
        className: 'dvb-input dvb-input-mono',
        type: 'number',
        step: 'any',
        value: newPointDraft.scale,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, scale: Number(e.target.value) })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-offset' },
      el('input', {
        className: 'dvb-input dvb-input-mono',
        type: 'number',
        step: 'any',
        value: newPointDraft.offset,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, offset: Number(e.target.value) })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-unit' },
      el('input', {
        className: 'dvb-input',
        value: newPointDraft.unit,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, unit: e.target.value })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-min' },
      el('input', {
        className: 'dvb-input dvb-input-mono',
        type: 'number',
        step: 'any',
        value: newPointDraft.alarmMin,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, alarmMin: e.target.value })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-max' },
      el('input', {
        className: 'dvb-input dvb-input-mono',
        type: 'number',
        step: 'any',
        value: newPointDraft.alarmMax,
        onChange: (e) => setNewPointDraft((prev) => ({ ...prev, alarmMax: e.target.value })),
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-ops' },
      el(
        'div',
        { className: 'dvb-actions' },
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
            disabled: !cwd,
            title: t('savePoint') || '保存',
            'aria-label': t('savePoint') || '保存',
            onClick: saveNewPointDraft,
          },
          '✓',
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm',
            title: t('csvCancel') || '取消',
            'aria-label': t('csvCancel') || '取消',
            onClick() {
              setNewPointDraft(null)
            },
          },
          '✕',
        ),
      ),
    ),
  )
}
