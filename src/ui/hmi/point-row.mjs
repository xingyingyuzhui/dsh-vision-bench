import { functionCodeOf, isWritableFunction } from '../../../bench-points.mjs'
import { focusHighlightClass, shouldHighlightFocus } from '../../../bench-shared.mjs'
import { renderCustomSelect } from '../components/custom-select.mjs'
import { AREA_BY_FN_EDIT, fnOptionLabel } from './hmi-ids.mjs'
import { renderInlineWriteCell } from './inline-write.mjs'
import { renderFlagSwitch } from './point-flags.mjs'

/** One point table row (view or edit). */
export function renderPointRow(el, t, ctx) {
  const CustomSelect = ctx.CustomSelect
  const {
    point,
    devId,
    showOps,
    valueMap,
    focusState,
    editingPointsDeviceId,
    pointDraftsById,
    inlineWrite,
    setInlineWrite,
    submitWriteCell,
    openWriteCell,
    busy,
    writeRunning,
    patchDraft,
    sendToAgent,
    flagSavingByPoint,
    persistPointFlags,
    removePointRow,
  } = ctx
  const rec = valueMap[point.id]
  const eng = rec?.ok && rec.value !== null && rec.value !== undefined ? rec.value : null
  const shown = eng !== null ? eng : rec && rec.ok === false ? rec.error : '—'
  const writable = isWritableFunction(point.function)
  const isFocused = shouldHighlightFocus(focusState) && focusState.request.pointId === point.id
  const editing = editingPointsDeviceId === devId
  const draft = editing ? pointDraftsById[point.id] || null : null
  const valueCell = renderInlineWriteCell(el, t, {
    point,
    inlineWrite,
    setInlineWrite,
    submitWriteCell,
    openWriteCell,
    writable,
    shown,
    busy,
    writeRunning,
  })
  return el(
    'tr',
    {
      key: point.id,
      'data-kind': 'pt',
      className: 'dvb-pt-row' + (point.isNew ? ' dvb-newpoint-row' : '') + focusHighlightClass(isFocused),
      'data-focused': isFocused ? 'true' : 'false',
      'data-editing': editing ? 'true' : 'false',
    },
    el(
      'td',
      { className: 'dvb-col-name' },
      editing
        ? el('input', {
            className: 'dvb-input',
            value: draft ? draft.name : point.name,
            onChange: (e) => patchDraft(point.id, { name: e.target.value }),
          })
        : el(
            'span',
            { className: 'dvb-cell-name' },
            el(
              'span',
              {
                className: 'dvb-cell-name-text',
                title: point.name || functionCodeOf(point.function) + point.address,
              },
              point.name || functionCodeOf(point.function) + point.address,
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-ai-btn',
                title: '复制结构化引用（稳定 ID+配置版本）并让 Agent 分析',
                'aria-label': '让 Agent 分析 ' + (point.name || point.id),
                onClick() {
                  sendToAgent('point', {
                    pointId: point.id,
                    connectionId: point.connectionId,
                    deviceId: point.deviceId,
                    name: point.name,
                  })
                },
              },
              'AI',
            ),
          ),
    ),
    el(
      'td',
      { className: 'dvb-col-monitor' },
      renderFlagSwitch(el, t, {
        checked: point.isNew
          ? draft
            ? draft.monitorEnabled === true
            : point.monitorEnabled === true
          : draft && draft.monitorEnabled !== undefined
            ? draft.monitorEnabled === true
            : point.monitorEnabled === true,
        title: point.isNew
          ? '开启后成为可视化数据源'
          : flagSavingByPoint[point.id + ':monitorEnabled']
            ? '监视状态保存中…'
            : '开启后成为可视化数据源',
        onToggle: (next) => {
          if (point.isNew) {
            patchDraft(point.id, { monitorEnabled: next })
          } else {
            if (editing) patchDraft(point.id, { monitorEnabled: next })
            persistPointFlags(point.id, { monitorEnabled: next })
          }
        },
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-fn' },
      editing
        ? CustomSelect
          ? el(CustomSelect, {
              id: `dvb-fc-${point.id}`,
              size: 'sm',
              value: String(draft && draft.function != null ? draft.function : point.function),
              options: [
                { value: '1', label: fnOptionLabel(t, 1), title: '01 线圈 (可读写)' },
                { value: '2', label: fnOptionLabel(t, 2), title: '02 离散输入 (只读)' },
                { value: '3', label: fnOptionLabel(t, 3), title: '03 保持寄存器 (可读写)' },
                { value: '4', label: fnOptionLabel(t, 4), title: '04 输入寄存器 (只读)' },
              ],
              onChange: (val) => {
                const next = val?.target ? val.target.value : val
                const fn = Number(next)
                patchDraft(point.id, { function: fn, area: AREA_BY_FN_EDIT[fn] })
              },
            })
          : renderCustomSelect(el, {
              id: `dvb-fc-${point.id}`,
              size: 'sm',
              value: String(draft && draft.function != null ? draft.function : point.function),
              options: [
                { value: '1', label: fnOptionLabel(t, 1), title: '01 线圈 (可读写)' },
                { value: '2', label: fnOptionLabel(t, 2), title: '02 离散输入 (只读)' },
                { value: '3', label: fnOptionLabel(t, 3), title: '03 保持寄存器 (可读写)' },
                { value: '4', label: fnOptionLabel(t, 4), title: '04 输入寄存器 (只读)' },
              ],
              onChange: (val) => {
                const next = val?.target ? val.target.value : val
                const fn = Number(next)
                patchDraft(point.id, { function: fn, area: AREA_BY_FN_EDIT[fn] })
              },
            })
        : el('span', { className: 'dvb-val' }, functionCodeOf(point.function)),
    ),
    el(
      'td',
      { className: 'dvb-col-addr' },
      editing
        ? el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            min: 0,
            max: 65535,
            value: draft ? draft.address : point.address,
            onChange: (e) => patchDraft(point.id, { address: Number(e.target.value) }),
          })
        : el('span', { className: 'dvb-val' }, String(point.address)),
    ),
    el(
      'td',
      { className: 'dvb-col-value dvb-val', 'data-ok': rec ? (rec.ok ? 'true' : 'false') : '' },
      point.isNew ? '—' : valueCell,
    ),
    el(
      'td',
      { className: 'dvb-col-unit' },
      editing
        ? el('input', {
            className: 'dvb-input',
            value: draft ? draft.unit : point.unit,
            onChange: (e) => patchDraft(point.id, { unit: e.target.value }),
          })
        : el('span', null, point.unit || '—'),
    ),
    el(
      'td',
      { className: 'dvb-col-scale' },
      editing
        ? el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            step: 'any',
            value: draft ? draft.scale : point.scale,
            onChange: (e) => patchDraft(point.id, { scale: Number(e.target.value) }),
          })
        : el('span', { className: 'dvb-val' }, (point.scale === 1 ? '' : '×' + point.scale) || '—'),
    ),
    el(
      'td',
      { className: 'dvb-col-offset' },
      editing
        ? el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            step: 'any',
            value: draft ? draft.offset : point.offset,
            onChange: (e) => patchDraft(point.id, { offset: Number(e.target.value) }),
          })
        : el('span', { className: 'dvb-val' }, point.offset ? (point.offset > 0 ? '+' : '') + point.offset : '—'),
    ),
    el(
      'td',
      { className: 'dvb-col-alarm' },
      renderFlagSwitch(el, t, {
        checked: point.isNew
          ? draft
            ? draft.alarmEnabled === true
            : point.alarmEnabled === true
          : draft && draft.alarmEnabled !== undefined
            ? draft.alarmEnabled === true
            : point.alarmEnabled === true,
        title: point.isNew
          ? '参与告警判断'
          : flagSavingByPoint[point.id + ':alarmEnabled']
            ? '告警状态保存中…'
            : '参与告警判断',
        onToggle: (next) => {
          if (point.isNew) {
            patchDraft(point.id, { alarmEnabled: next })
          } else {
            if (editing) patchDraft(point.id, { alarmEnabled: next })
            persistPointFlags(point.id, { alarmEnabled: next })
          }
        },
      }),
    ),
    el(
      'td',
      { className: 'dvb-col-min' },
      editing
        ? el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            step: 'any',
            placeholder: '—',
            value: draft ? draft.alarmMin : point.alarmMin == null ? '' : point.alarmMin,
            onChange: (e) => patchDraft(point.id, { alarmMin: e.target.value }),
          })
        : el('span', { className: 'dvb-val' }, point.alarmMin == null ? '—' : String(point.alarmMin)),
    ),
    el(
      'td',
      { className: 'dvb-col-max' },
      editing
        ? el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            step: 'any',
            placeholder: '—',
            value: draft ? draft.alarmMax : point.alarmMax == null ? '' : point.alarmMax,
            onChange: (e) => patchDraft(point.id, { alarmMax: e.target.value }),
          })
        : el('span', { className: 'dvb-val' }, point.alarmMax == null ? '—' : String(point.alarmMax)),
    ),
    editing
      ? el(
          'td',
          { className: 'dvb-col-ops' },
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
              title: '删除该点位',
              'aria-label': '删除点位 ' + (point.name || point.id),
              onClick() {
                removePointRow(point)
              },
            },
            '✕',
          ),
        )
      : showOps
        ? el('td', { className: 'dvb-col-ops' }, null)
        : null,
  )
}
