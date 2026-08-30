import { normalizeModbus } from './bench-devices.mjs'
export const TARGET_CODES = { TARGET_REQUIRED: 'TARGET_REQUIRED', TARGET_MISMATCH: 'TARGET_MISMATCH' }
const t = (v) => (typeof v === 'string' ? v.trim() : '')
const cOf = (p, c) => (p.connections || []).find((x) => x.id === c) || null
const dOf = (p, d) => (p.devices || []).find((x) => x.id === d) || null
const pOf = (p, x) => (p.points || []).find((y) => y.id === x) || null
export function resolveTarget(pack, target) {
  const p =
    pack && pack.connections
      ? pack
      : (() => {
          try {
            return normalizeModbus(pack)
          } catch {
            return pack
          }
        })()
  const q = target && typeof target === 'object' ? target : {}
  const connectionId = t(q.connectionId || q.connId),
    deviceId = t(q.deviceId),
    pointId = t(q.pointId || q.id),
    frameId = t(q.frameId),
    alarmId = t(q.alarmId),
    trendKey = t(q.trendKey),
    visualizationId = t(q.visualizationId)
  if (!connectionId && !deviceId && !pointId && !frameId && !alarmId && !trendKey && !visualizationId)
    return { ok: false, error: '缺少目标 ID', errorCode: TARGET_CODES.TARGET_REQUIRED }
  // Task5/0.20.1: 组件聚焦不需要 connectionId
  if (visualizationId) {
    const vizComp = ((p.visualization && p.visualization.components) || []).find((c) => c.id === visualizationId)
    if (!vizComp) return { ok: false, error: '组件不存在: ' + visualizationId, errorCode: 'VIZ_NOT_FOUND' }
    return {
      ok: true,
      visualization: vizComp,
      visualizationId,
      connection: null,
      device: null,
      point: null,
      frame: null,
      alarm: null,
      connectionId: '',
      deviceId: '',
      pointId: '',
    }
  }
  if (trendKey) {
    const s = trendKey.split(':')
    if (s.length !== 3 || !s[0] || !s[1] || !s[2])
      return {
        ok: false,
        error: 'trendKey 格式应为 connectionId:deviceId:pointId',
        errorCode: TARGET_CODES.TARGET_REQUIRED,
      }
    const [a, b, c] = s.map((x) => x.trim())
    if (connectionId && connectionId !== a)
      return { ok: false, error: 'trendKey 与 connectionId 不一致', errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (deviceId && deviceId !== b)
      return { ok: false, error: 'trendKey 与 deviceId 不一致', errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (pointId && pointId !== c)
      return { ok: false, error: 'trendKey 与 pointId 不一致', errorCode: TARGET_CODES.TARGET_MISMATCH }
    const cn = cOf(p, a)
    if (!cn) return { ok: false, error: '连接不存在: ' + a, errorCode: TARGET_CODES.TARGET_MISMATCH }
    const dv = dOf(p, b)
    if (!dv) return { ok: false, error: '设备不存在: ' + b, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (dv.connectionId !== a) return { ok: false, error: '设备不属于连接', errorCode: TARGET_CODES.TARGET_MISMATCH }
    const pt = pOf(p, c)
    if (!pt) return { ok: false, error: '点位不存在: ' + c, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (pt.connectionId !== a || pt.deviceId !== b)
      return { ok: false, error: '点位不属于设备/连接', errorCode: TARGET_CODES.TARGET_MISMATCH }
    return { ok: true, connection: cn, device: dv, point: pt, trendKey, connectionId: a, deviceId: b, pointId: c }
  }
  let connection = null
  if (connectionId) {
    connection = cOf(p, connectionId)
    if (!connection) return { ok: false, error: '连接不存在: ' + connectionId, errorCode: TARGET_CODES.TARGET_MISMATCH }
  } else {
    if (deviceId || pointId || frameId || alarmId)
      return { ok: false, error: '缺少 connectionId', errorCode: TARGET_CODES.TARGET_REQUIRED }
    return { ok: false, error: '缺少 connectionId', errorCode: TARGET_CODES.TARGET_REQUIRED }
  }
  let device = null
  if (deviceId) {
    device = dOf(p, deviceId)
    if (!device) return { ok: false, error: '设备不存在: ' + deviceId, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (!pointId && device.connectionId !== connection.id)
      return { ok: false, error: '设备不属于连接', errorCode: TARGET_CODES.TARGET_MISMATCH }
  }
  let point = null
  if (pointId) {
    point = pOf(p, pointId)
    if (!point) return { ok: false, error: '点位不存在: ' + pointId, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (point.connectionId !== connection.id)
      return { ok: false, error: '不在点表：点位不在指定连接: ' + pointId, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (device && point.deviceId !== device.id)
      return { ok: false, error: '点位不在指定设备: ' + pointId, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (!device) {
      const dp = dOf(p, point.deviceId)
      if (!dp || dp.connectionId !== connection.id)
        return { ok: false, error: '不在点表：点位设备不属于连接: ' + pointId, errorCode: TARGET_CODES.TARGET_MISMATCH }
      device = dp
    }
  }
  let frame = null
  if (frameId) {
    const m = p.framesByConnection || {},
      a = m[connection.id] || []
    frame = a.find((f) => f && (f.id === frameId || f.frameId === frameId)) || null
    if (!frame) {
      let e = null
      for (const [cid, l] of Object.entries(m)) {
        if (cid === connection.id) continue
        const h = (l || []).find((f) => f && (f.id === frameId || f.frameId === frameId))
        if (h) {
          e = h
          break
        }
      }
      if (e) return { ok: false, error: '报文不属于连接', errorCode: TARGET_CODES.TARGET_MISMATCH }
      return { ok: false, error: '报文不存在: ' + frameId, errorCode: TARGET_CODES.TARGET_MISMATCH }
    }
  }
  let alarm = null
  if (alarmId) {
    const s = p.alarmState || p.alarmActive || {}
    alarm = s[alarmId]
    if (!alarm) return { ok: false, error: '告警不存在: ' + alarmId, errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (alarm.connectionId && alarm.connectionId !== connection.id)
      return { ok: false, error: '告警不属于连接', errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (alarm.deviceId && device && alarm.deviceId !== device.id)
      return { ok: false, error: '告警不属于设备', errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (alarm.pointId && pointId && alarm.pointId !== pointId)
      return { ok: false, error: '告警与点位不一致', errorCode: TARGET_CODES.TARGET_MISMATCH }
    if (alarm.pointId && !point) {
      const pp = pOf(p, alarm.pointId)
      if (pp) {
        if (pp.connectionId !== connection.id)
          return { ok: false, error: '告警点位不属于连接', errorCode: TARGET_CODES.TARGET_MISMATCH }
        if (device && pp.deviceId !== device.id)
          return { ok: false, error: '告警点位不属于设备', errorCode: TARGET_CODES.TARGET_MISMATCH }
      }
    }
  }
  return {
    ok: true,
    connection,
    device: device || (point ? dOf(p, point.deviceId) : null),
    point,
    frame,
    alarm,
    connectionId: connection.id,
    deviceId: device ? device.id : point ? point.deviceId : '',
    pointId,
    frameId,
    alarmId,
  }
}
