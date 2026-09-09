// TaskP2/0.20.0: 可视化组件点位选择器 VizPointPicker
import { pointCompatible, groupPointsByDevice } from '../viz-helpers.mjs'

const formatBadge = (fn, addr = '') => (fn >= 1 && fn <= 4 ? `0${fn} ${addr}` : String(addr))

export function createVizPointPicker(React, t) {
  const el = React.createElement

  return function VizPointPicker({
    editor,
    setEditor,
    pointOptions = [],
    points = [],
    devices = [],
    connections = [],
  }) {
    const [filterKind, setFilterKind] = React.useState('all')
    const byPointId = new Map(points.map((p) => [p.id, p]))
    const singleSelect = editor.type === 'value' || editor.type === 'switch'
    const q = (editor.search || '').toLowerCase()

    const editorOpts = pointOptions.filter((o) => {
      const isBool = o.function === 1 || o.function === 2
      if ((filterKind === 'numeric' && isBool) || (filterKind === 'bool' && !isBool)) return false
      if (q && !`${o.name} ${o.path} ${o.pointId}`.toLowerCase().includes(q)) return false
      return pointCompatible(editor.type, o.function) || editor.pointIds.includes(o.pointId)
    })

    const orphanSelected = (editor.pointIds || [])
      .filter((id) => !pointOptions.some((o) => o.pointId === id))
      .map((id) => {
        const raw = byPointId.get(id)
        return { pointId: id, name: raw?.name || id, path: '不可用', function: raw?.function || 0, deviceId: raw?.deviceId || '', connectionId: raw?.connectionId || '' }
      })

    const devGroups = groupPointsByDevice([...editorOpts, ...orphanSelected], { devices, connections })

    const togglePoint = (id) =>
      setEditor((p) => ({
        ...p,
        pointIds: singleSelect ? [id] : p.pointIds.includes(id) ? p.pointIds.filter((x) => x !== id) : [...p.pointIds, id],
      }))

    const pill = (on, fn, txt, k) =>
      el('button', { key: k, type: 'button', className: `dvb-viz-filter-pill${on ? ' is-active' : ''}`, onClick: fn }, txt)

    return el(
      'div',
      { className: 'dvb-viz-form-section dvb-viz-picker' },
      el(
        'div',
        { className: 'dvb-viz-form-label' },
        '关联监控点位',
        el('span', { className: 'dvb-hint' }, editor.pointIds.length ? `已选 ${editor.pointIds.length} 个点位` : '未选择点位'),
      ),
      el(
        'div',
        { className: 'dvb-viz-search-bar' },
        el('input', {
          className: 'dvb-input',
          placeholder: t('vizSearch') || '搜索已监视点位…',
          value: editor.search || '',
          onChange: (e) => setEditor((p) => ({ ...p, search: e.target.value })),
        }),
      ),
      el(
        'div',
        { className: 'dvb-viz-filter-pills' },
        [['all', `全部 (${pointOptions.length})`], ['numeric', '模拟量'], ['bool', '开关量']].map(([k, lbl]) =>
          pill(filterKind === k, () => setFilterKind(k), lbl, k),
        ),
      ),
      el(
        'div',
        { className: 'dvb-viz-picker-list' },
        devGroups.length
          ? devGroups.map((grp) =>
              el(
                'div',
                { key: grp.key, className: 'dvb-viz-picker-group' },
                el(
                  'div',
                  { className: 'dvb-viz-picker-dev-head' },
                  el('span', { className: 'dvb-viz-picker-dev-title' }, grp.deviceName),
                  grp.connectionName && el('span', { className: 'dvb-hint dvb-viz-picker-dev-conn' }, grp.connectionName),
                  el('span', { className: 'dvb-hint dvb-viz-picker-dev-count' }, `${grp.points.length} 个点位`),
                ),
                grp.points.map((o) => {
                  const incompatible = !pointCompatible(editor.type, o.function)
                  const checked = editor.pointIds.includes(o.pointId)
                  return el(
                    'label',
                    { key: o.pointId, className: `dvb-viz-picker-opt${checked ? ' is-checked' : ''}`, title: o.path },
                    el('input', {
                      type: singleSelect ? 'radio' : 'checkbox',
                      checked,
                      className: 'dvb-viz-hidden-input',
                      onChange: () => togglePoint(o.pointId),
                    }),
                    el('span', { className: 'dvb-viz-picker-name' }, o.name),
                    o.function ? el('span', { className: 'dvb-viz-reg-badge' }, formatBadge(o.function, o.address)) : null,
                    incompatible && [
                      el('span', { key: 'w', className: 'dvb-badge', 'data-kind': 'warn' }, '不兼容'),
                      el('button', { key: 'r', type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: (ev) => { ev.preventDefault(); togglePoint(o.pointId) } }, '移除'),
                    ],
                    el('span', { className: 'dvb-hint' }, o.path),
                    el('span', { className: `dvb-switch${checked ? ' is-on' : ''}` }, el('span', { className: 'dvb-switch-track' })),
                  )
                }),
              ),
            )
          : el(
              'div',
              { className: 'dvb-hint' },
              pointOptions.length
                ? t('vizNoCompatiblePoints') || '无可用已监视点位'
                : t('vizNoMonitoredPoints') || '请先开启点位监视',
            ),
      ),
    )
  }
}
