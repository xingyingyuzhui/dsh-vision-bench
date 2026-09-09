import { getCustomSelect } from '../../components/custom-select.mjs'

/**
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createFramesFilterToolbar(React, t) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)

  return function FramesFilterToolbar(props) {
    const {
      mode,
      selection,
      setSelection,
      setPendingNew,
      portOptions,
      showFilters,
      setShowFilters,
      search,
      setSearch,
      filters,
      setFilters,
      devices,
    } = props

    return el(
      React.Fragment,
      null,
      el(
        'div',
        { className: 'dvb-toolbar' },
        el(CustomSelect, {
          style: { minWidth: '160px', flex: '1' },
          value: selection,
          options: (portOptions || []).map((o) => ({ value: o.value, label: o.label })),
          onChange(val) {
            const next = val?.target ? val.target.value : val
            setSelection(next)
            setPendingNew(0)
          },
        }),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            onClick() {
              setShowFilters((v) => !v)
            },
          },
          t('framesFilters') || '筛选',
        ),
        el('input', {
          className: 'dvb-input',
          value: search,
          placeholder: t('serialFilter') || '搜索报文……',
          onChange: (e) => setSearch(e.target.value),
        }),
      ),
      showFilters && mode === 'proto'
        ? el(
            'div',
            { className: 'dvb-toolbar' },
            el(CustomSelect, {
              style: { minWidth: '120px', flex: '1' },
              value: filters.deviceId,
              options: [
                { value: '', label: '全部设备' },
                ...(devices || []).map((d) => ({ value: d.id, label: `${d.name} · 站号 ${d.unitId}` })),
              ],
              onChange(val) {
                const deviceId = val?.target ? val.target.value : val
                setFilters((p) => ({ ...p, deviceId }))
              },
            }),
            el(CustomSelect, {
              style: { minWidth: '110px', flex: '1' },
              value: filters.functionCode,
              options: [
                { value: '', label: '全部功能码' },
                ...[1, 2, 3, 4, 5, 6, 15, 16].map((fc) => ({
                  value: String(fc),
                  label: String(fc).padStart(2, '0'),
                })),
              ],
              onChange(val) {
                const functionCode = val?.target ? val.target.value : val
                setFilters((p) => ({ ...p, functionCode }))
              },
            }),
            el(CustomSelect, {
              style: { minWidth: '95px', flex: '1' },
              value: filters.status,
              options: [
                { value: '', label: '全部状态' },
                { value: 'ok', label: '成功' },
                { value: 'err', label: '失败' },
              ],
              onChange(val) {
                const status = val?.target ? val.target.value : val
                setFilters((p) => ({ ...p, status }))
              },
            }),
            el(CustomSelect, {
              style: { minWidth: '95px', flex: '1' },
              value: filters.source,
              options: [
                { value: '', label: '全部来源' },
                { value: 'manual', label: '用户' },
                { value: 'polling', label: '自动刷新' },
                { value: 'agent', label: 'Agent' },
              ],
              onChange(val) {
                const source = val?.target ? val.target.value : val
                setFilters((p) => ({ ...p, source }))
              },
            }),
          )
        : null,
    )
  }
}
