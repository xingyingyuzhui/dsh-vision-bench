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
    const [openMap, setOpenMap] = React.useState({})
    const byPointId = new Map(points.map((p) => [p.id, p]))
    const singleSelect = editor.type === 'value' || editor.type === 'switch'
    const q = (editor.search || '').toLowerCase()
    const selectedOf = (grp) => grp.points.filter((o) => editor.pointIds.includes(o.pointId)).length
    const isOpen = (grp, i) => {
      if (q) return true
      if (grp.key in openMap) return !!openMap[grp.key]
      return selectedOf(grp) > 0 || i === 0
    }

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
          ? devGroups.map((grp, i) => {
              const open = isOpen(grp, i)
              const selectedN = selectedOf(grp)
              return el(
                'div',
                { key: grp.key, className: 'dvb-viz-picker-group', 'data-folded': open ? undefined : 'true' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-viz-picker-dev-head',
                    'aria-expanded': open ? 'true' : 'false',
                    onClick: () => setOpenMap((prev) => ({ ...prev, [grp.key]: !open })),
                  },
                  el(
                    'span',
                    { className: 'dvb-viz-picker-chevron', 'aria-hidden': 'true' },
                    el(
                      'svg',
                      { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' },
                      el('path', {
                        d: 'M4.25 2.82782L4.25 11.1722C4.25 11.6622 4.84243 11.9076 5.18891 11.5611L9.36109 7.38891C9.57588 7.17412 9.57588 6.82588 9.36109 6.61109L5.18891 2.43891C4.84243 2.09243 4.25 2.33782 4.25 2.82782Z',
                        fill: 'currentColor',
                      }),
                    ),
                  ),
                  el('span', { className: 'dvb-viz-picker-dev-title' }, grp.deviceName),
                  grp.connectionName && el('span', { className: 'dvb-hint dvb-viz-picker-dev-conn' }, grp.connectionName),
                  el(
                    'span',
                    { className: 'dvb-hint dvb-viz-picker-dev-count' },
                    selectedN ? `${selectedN}/${grp.points.length} 已选` : `${grp.points.length} 个点位`,
                  ),
                ),
                open
                  ? el(
                      'div',
                      { className: 'dvb-viz-picker-dev-body' },
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
                          el('span', { className: `dvb-switch${checked ? ' is-on' : ''}` }, el('span', { className: 'dvb-switch-track' })),
                        )
                      }),
                    )
                  : null,
              )
            })
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
