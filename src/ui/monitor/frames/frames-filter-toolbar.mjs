import { getCustomSelect } from '../../components/custom-select.mjs'

const SEL = { width: '140px', minWidth: '140px', flex: 'none' }

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
      search,
      setSearch,
      filters,
      setFilters,
      devices,
      onReset,
    } = props

    const protoFilters =
      mode === 'proto'
        ? [
            el(CustomSelect, {
              key: 'device',
              style: SEL,
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
              key: 'fc',
              style: SEL,
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
              key: 'status',
              style: SEL,
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
              key: 'source',
              style: SEL,
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
          ]
        : []

    return el(
      'div',
      { className: 'dvb-frames-filter-row' },
      el(CustomSelect, {
        style: SEL,
        value: selection,
        options: (portOptions || []).map((o) => ({ value: o.value, label: o.label })),
        onChange(val) {
          const next = val?.target ? val.target.value : val
          setSelection(next)
          setPendingNew(0)
        },
      }),
      el(CustomSelect, {
        style: SEL,
        value: filters.direction || '',
        options: [
          { value: '', label: '全部方向' },
          { value: 'tx', label: 'TX 发送' },
          { value: 'rx', label: 'RX 接收' },
        ],
        onChange(val) {
          const direction = val?.target ? val.target.value : val
          setFilters((p) => ({ ...p, direction }))
        },
      }),
      ...protoFilters,
      el('input', {
        className: 'dvb-input dvb-frames-search',
        style: { width: '180px', flex: 'none' },
        value: search,
        placeholder: t('serialFilter') || '过滤关键字',
        onChange: (e) => setSearch(e.target.value),
      }),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn',
          onClick: onReset,
        },
        '重置',
      ),
    )
  }
}
