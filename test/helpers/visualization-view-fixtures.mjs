// @ts-check
/** Shared Modbus pack + makePost for visualization page suites (P2-5). */
export const MB = {
  version: 3,
  configVersion: 9,
  connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
  devices: [{ id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 }],
  points: [
    {
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '温度',
      function: 3,
      address: 0,
      monitorEnabled: true,
      alarmEnabled: true,
    },
    {
      id: 'p2',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '压力',
      function: 3,
      address: 1,
      monitorEnabled: true,
      alarmEnabled: false,
    },
    {
      id: 'p3',
      connectionId: 'c1',
      deviceId: 'd1',
      name: '未监视',
      function: 3,
      address: 2,
      monitorEnabled: false,
      alarmEnabled: false,
    },
  ],
  values: [{ key: 'p1', pointId: 'p1', value: 23.5, ok: true, at: Date.now() }],
  trend: {
    p1: [
      [Date.now() - 1000, 23],
      [Date.now(), 23.5],
    ],
  },
  alarmState: {},
  visualization: { schemaVersion: 1, components: [] },
}

export const makePost = (mb = JSON.parse(JSON.stringify(MB))) => {
  const saved = []
  const post = async (path, body) => {
    if (/\/state$/.test(path))
      return {
        ok: true,
        workspace: { modbus: mb, focus: null },
        journal: { tasks: [], running: [], timeline: [] },
        health: {},
        pendingWrites: [],
      }
    if (/\/command$/.test(path) && body.action === 'visualization') {
      saved.push(body)
      const payload = body.payload || {}
      const current = mb.visualization || { schemaVersion: 1, components: [] }
      let components = current.components.slice()
      if (payload.op === 'add') components.push(payload.component)
      if (payload.op === 'update') {
        components = components.map((component) =>
          component.id === payload.visualizationId
            ? { ...component, ...payload.component, id: component.id }
            : component,
        )
      }
      if (payload.op === 'remove')
        components = components.filter((component) => component.id !== payload.visualizationId)
      if (payload.op === 'layout' && Array.isArray(payload.items)) {
        const byId = new Map(payload.items.map((item) => [item.id, item]))
        components = components.map((component) =>
          byId.has(component.id)
            ? {
                ...component,
                layout: {
                  x: byId.get(component.id).x,
                  y: byId.get(component.id).y,
                  w: byId.get(component.id).w,
                  h: byId.get(component.id).h,
                },
              }
            : component,
        )
      }
      mb = { ...mb, configVersion: (mb.configVersion || 1) + 1, visualization: { schemaVersion: 1, components } }
      return { ok: true, workspace: { modbus: mb } }
    }
    return { ok: true }
  }
  return { post, saved, state: () => mb }
}

export const t = (k) =>
  ({
    liveChart: '可视化',
    vizNew: '新建组件',
    vizEdit: '编辑组件',
    vizName: '组件名称',
    vizType: '组件类型',
    vizSearch: '搜索',
    vizCreate: '创建组件',
    vizSave: '保存修改',
    savePoint: '保存',
    csvCancel: '取消',
    vizReadOnlyTitle: '可视化配置为只读',
    vizReadOnlyHint: '当前可以查看组件和实时数据，但不能修改布局、组件配置或执行组件控制。请升级插件后再编辑。',
    vizReadOnlyAction: '当前配置由更高版本插件创建，无法修改',
    vizChartUnavailable: '图表运行时不可用',
  })[k] || k
