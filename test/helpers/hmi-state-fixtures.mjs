// @ts-check
/** Modbus pack + i18n + post stub fixtures for HMI page tests (P4-1). */

/** Default Modbus pack used by point-table UX suites. */
export const MB = {
  version: 3,
  configVersion: 7,
  connections: [
    {
      id: 'c1',
      name: 'C1',
      role: 'client',
      enabled: true,
      conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true },
    },
  ],
  devices: [
    { id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 },
    { id: 'd2', connectionId: 'c1', name: '设备2', unitId: 2 },
  ],
  points: [
    {
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '温度',
      function: 3,
      address: 0,
      scale: 0.1,
      offset: 0,
      unit: '℃',
      monitorEnabled: true,
      alarmEnabled: true,
      alarmMin: 18,
      alarmMax: 30,
    },
    {
      id: 'p2',
      connectionId: 'c1',
      deviceId: 'd2',
      name: '开关',
      function: 1,
      address: 0,
      scale: 1,
      offset: 0,
      unit: '',
      monitorEnabled: false,
      alarmEnabled: false,
    },
    {
      id: 'p3',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '压力',
      function: 3,
      address: 1,
      scale: 1,
      offset: 0,
      unit: 'kPa',
      monitorEnabled: true,
      alarmEnabled: false,
    },
  ],
  values: [{ key: 'p1', pointId: 'p1', raw: 235, value: 23.5, ok: true, at: Date.now() }],
  alarmState: {},
  pollingByConnection: { c1: { enabled: false, intervalMs: 1000 } },
  framesByConnection: {},
}

/** Flags-race Modbus pack (single device, two points). */
export function baseMb() {
  return {
    version: 3,
    configVersion: 10,
    connections: [
      {
        id: 'c1',
        name: 'C1',
        role: 'client',
        enabled: true,
        conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true },
      },
    ],
    devices: [{ id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 }],
    points: [
      {
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        scale: 1,
        offset: 0,
        unit: '',
        monitorEnabled: false,
        alarmEnabled: false,
        alarmMin: 1,
        alarmMax: 9,
      },
      {
        id: 'p2',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '压力',
        function: 3,
        address: 1,
        scale: 1,
        offset: 0,
        unit: '',
        monitorEnabled: false,
        alarmEnabled: false,
      },
    ],
    values: [],
    pollingByConnection: {},
    framesByConnection: {},
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  }
}

/** i18n stub covering point-table + flags suites. */
export const t = (k) =>
  ({
    addPoint: '添加点位',
    batchAdd: '批量添加',
    batchGenerate: '生成',
    batchPrefix: '前缀',
    batchStart: '起始',
    batchCount: '数量',
    ptName: '名称',
    ptNamePh: '名称',
    ptFc: '功能码',
    ptAddr: '地址',
    ptUnit: '单位',
    colName: '名称',
    colFn: '功能码',
    colAddr: '地址',
    monitorOn: '监视',
    alarmOn: '告警',
    ptAlarmMin: '下限',
    ptAlarmMax: '上限',
    savePoint: '保存',
    csvCancel: '取消',
    csvImport: '导入 CSV',
    csvExport: '导出 CSV',
    readAll: '读取',
    devEdit: '编辑设备',
    ptEdit: '编辑点位',
    ptSave: '保存',
    devSave: '保存',
    editing: '编辑',
    deleteSegment: '删除',
    noPoints: '暂无点位',
    writing: '写入中…',
    quickWrite: '写入',
  })[k] || k

export const makePost = (mb = MB) => {
  const posts = []
  const post = async (path, body) => {
    posts.push([path, body || {}])
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
        connectionStates: [{ connectionId: 'c1', status: 'connected' }],
      }
    }
    if (/\/dsh-vision-bench\/serial\/ports$/.test(path)) return { ok: true, ports: ['COM3'] }
    if (/\/dsh-vision-bench\/modbus\/write$/.test(path)) {
      return {
        ok: true,
        values: [{ key: body.pointId, pointId: body.pointId, raw: 300, value: 30, ok: true, at: Date.now() }],
        framesLog: [],
      }
    }
    return { ok: true }
  }
  return { post, posts }
}
