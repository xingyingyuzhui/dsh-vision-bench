// @ts-check

/** Point fields accepted by the batched `points` tool item. */
export const POINT_BATCH_ITEM_PROPERTIES = {
  id: { type: 'string' },
  name: { type: 'string' },
  function: { type: 'number' },
  address: { type: 'number', description: '协议地址，保持寄存器 0 = 40001' },
  scale: { type: 'number' },
  offset: { type: 'number' },
  unit: { type: 'string' },
  alarmMin: { type: 'number' },
  alarmMax: { type: 'number' },
  alarmDeadband: {
    type: 'number',
    description: '告警回差（工程单位，≥0）。缺省为 |阈值|×1%；显式 0 表示无回差',
  },
  monitorEnabled: {
    type: 'boolean',
    description: '规范监视开关',
  },
  alarmEnabled: { type: 'boolean' },
  trendEnabled: {
    type: 'boolean',
    description: 'monitorEnabled 的旧别名；冲突时 FIELD_CONFLICT，批量原子失败',
  },
  connectionId: { type: 'string' },
  deviceId: { type: 'string' },
}
