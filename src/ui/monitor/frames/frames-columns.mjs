import {
  formatFrameClock,
  formatHexDisplay,
  formatPortName,
  frameByteCount,
  frameDirection,
  framePayloadHex,
  hexToUtf8Preview,
} from './frames-format.mjs'

function dirPill(el, dir) {
  const rx = dir === 'rx'
  return el('span', { className: 'dvb-frames-dir', 'data-dir': rx ? 'rx' : 'tx' }, rx ? 'RX 接收' : 'TX 发送')
}

function dataCell(el, frame, encoding) {
  const hex = framePayloadHex(frame)
  const text = encoding === 'text' ? hexToUtf8Preview(hex) : formatHexDisplay(hex) || frame.request || ''
  return el('span', { className: 'dvb-frames-data' }, text || '—')
}

/**
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {any} props
 * @param {{
 *   mode: 'proto' | 'raw',
 *   devices: any[],
 *   connections?: any[],
 *   encoding: 'hex' | 'text',
 *   colWidths?: Record<string, number>,
 * }} opts
 */
export function buildFrameColumns(React, t, props, opts) {
  const el = React.createElement
  const { mode, devices, connections = [], encoding, colWidths = {} } = opts
  void props
  void t

  const timeCol = {
    id: 'time',
    header: '时间',
    size: colWidths.time || 76,
    accessorFn: (f) => f.t || f.at,
    cell: (info) => el('span', { className: 'dvb-map-meta' }, formatFrameClock(info.getValue())),
  }
  const portCol = {
    id: 'port',
    header: '端口',
    size: colWidths.port || 72,
    accessorFn: (f) => formatPortName(f, connections),
  }
  const dirCol = {
    id: 'dir',
    header: '方向',
    size: colWidths.dir || 88,
    accessorFn: (f) => frameDirection(f),
    cell: (info) => dirPill(el, info.getValue()),
  }
  const bytesCol = {
    id: 'bytes',
    header: '字节数',
    size: colWidths.bytes || 64,
    accessorFn: (f) => frameByteCount(f),
  }
  const dataCol = {
    id: 'hex',
    header: '数据',
    minSize: colWidths.hex || 180,
    accessorFn: (f) => framePayloadHex(f),
    cell: (info) => dataCell(el, info.row.original, encoding),
  }

  if (mode === 'raw') return [timeCol, portCol, dirCol, bytesCol, dataCol]

  return [
    timeCol,
    portCol,
    dirCol,
    {
      id: 'device',
      header: '设备',
      size: colWidths.device || 88,
      accessorFn: (f) => {
        const dev = devices.find((d) => d.id === f.deviceId)
        return dev?.name || f.deviceName || f.deviceId || ''
      },
    },
    {
      id: 'fc',
      header: '功能码',
      size: colWidths.fc || 64,
      accessorFn: (f) => f.functionCode,
      cell: (info) => {
        const val = info.getValue()
        if (val == null || val === '') return '—'
        const n = Number(val)
        return el('span', { className: 'dvb-hint' }, Number.isFinite(n) ? String(n).padStart(2, '0') : String(val))
      },
    },
    {
      id: 'status',
      header: '状态',
      size: colWidths.status || 64,
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
    dataCol,
  ]
}
