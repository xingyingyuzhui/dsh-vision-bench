import { hasHarnessInput } from '../../../../bench-shared.mjs'

/**
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {any} props
 * @param {{
 *   mode: 'proto' | 'raw',
 *   devices: any[],
 *   copied: string,
 *   sendToAgent: (frame: any) => void
 * }} opts
 */
export function buildFrameColumns(React, t, props, opts) {
  const el = React.createElement
  const { mode, devices, copied, sendToAgent } = opts

  if (mode === 'raw') {
    return [
      {
        id: 'time',
        header: '时间',
        accessorFn: (f) => f.t || f.at,
        cell: (info) =>
          el('span', { className: 'dvb-map-meta' }, new Date(info.getValue() || Date.now()).toLocaleTimeString()),
      },
      { id: 'port', header: '端口', accessorFn: (f) => f.port || f.connectionId || '' },
      {
        id: 'dir',
        header: '方向',
        accessorFn: (f) => f.direction || 'tx',
        cell: (info) => el('span', { className: 'dvb-badge' }, String(info.getValue() || 'tx').toUpperCase()),
      },
      {
        id: 'bytes',
        header: '字节',
        accessorFn: (f) => f.bytes || f.byteLength || (f.hex || '').length / 2 || '',
      },
      { id: 'hex', header: '数据', minSize: 160, accessorFn: (f) => f.hex || f.request || '' },
      {
        id: 'ai',
        header: '',
        enableSorting: false,
        size: 56,
        accessorFn: (f) => f.frameId || f.id,
        cell: (info) =>
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              title: hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent',
              onClick(ev) {
                if (ev?.stopPropagation) ev.stopPropagation()
                sendToAgent(info.row.original)
              },
            },
            copied === '已加入输入框' ? '已加入' : copied === '已发送' ? '已发送' : 'AI',
          ),
      },
    ]
  }

  return [
    {
      id: 'time',
      header: '时间',
      accessorFn: (f) => f.t || f.at,
      cell: (info) =>
        el('span', { className: 'dvb-map-meta' }, new Date(info.getValue() || Date.now()).toLocaleTimeString()),
    },
    { id: 'port', header: '端口', accessorFn: (f) => f.port || f.connectionId || '' },
    {
      id: 'device',
      header: '设备',
      accessorFn: (f) => {
        const dev = devices.find((d) => d.id === f.deviceId)
        return dev?.name || f.deviceName || f.deviceId || ''
      },
    },
    {
      id: 'unit',
      header: '站号',
      accessorFn: (f) => {
        const dev = devices.find((d) => d.id === f.deviceId)
        return f.unitId || dev?.unitId || '—'
      },
    },
    {
      id: 'fc',
      header: '功能码',
      accessorFn: (f) => f.functionCode,
      cell: (info) => {
        const val = info.getValue()
        if (val == null || val === '') return '—'
        const n = Number(val)
        return el('span', { className: 'dvb-hint' }, Number.isFinite(n) ? String(n).padStart(2, '0') : String(val))
      },
    },
    {
      id: 'dur',
      header: '耗时',
      accessorFn: (f) => f.durationMs,
      cell: (info) => (info.getValue() != null ? `${info.getValue()}ms` : ''),
    },
    {
      id: 'src',
      header: '来源',
      accessorFn: (f) => f.source,
      cell: (info) => {
        const src = info.getValue()
        return src === 'agent'
          ? t('framesSrcAgent') || 'Agent'
          : src === 'polling'
            ? t('framesSrcPoll') || '自动刷新'
            : src
              ? t('framesSrcUser') || '用户'
              : ''
      },
    },
    {
      id: 'status',
      header: '状态',
      accessorFn: (f) => f.status,
      cell: (info) => {
        const status = info.getValue()
        return el(
          'span',
          { className: 'dvb-badge', 'data-kind': status === 'ok' ? 'ready' : 'err' },
          status === 'ok' ? '成功' : status || '失败',
        )
      },
    },
    {
      id: 'ai',
      header: '',
      enableSorting: false,
      size: 56,
      accessorFn: (f) => f.frameId || f.id,
      cell: (info) =>
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm',
            title: hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent',
            onClick(ev) {
              if (ev?.stopPropagation) ev.stopPropagation()
              sendToAgent(info.row.original)
            },
          },
          copied === '已加入输入框' ? '已加入' : copied === '已发送' ? '已发送' : 'AI',
        ),
    },
  ]
}
