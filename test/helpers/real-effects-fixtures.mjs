// Shared fixtures for Frames/Visualization real React lifecycle tests (P2-2).
export const RTU_C1 = { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }
export const RTU_C2 = { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } }
export const SOURCE_C1 = { connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }
export const SOURCE_C2 = { connectionId: 'c2', port: 'COM4', state: 'connected', name: 'C2' }

export const makeFrames = (connId, n, startAt = 1000) =>
  Array.from({ length: n }, (_, i) => ({
    frameId: connId + '-f' + (startAt + i),
    connectionId: connId,
    deviceId: 'd1',
    t: startAt + i,
    at: startAt + i,
    direction: 'tx',
    request: 'req' + i,
    label: 'L' + i,
    status: 'ok',
    functionCode: 3,
  }))

/** Minimal `/state` payload shared by frames-feed and frames-real effect suites. */
export function framesStatePayload(opts = {}) {
  const { frames = {}, connections = [RTU_C1], configVersion = 1, health = {} } = opts
  const payload = {
    ok: true,
    workspace: {
      modbus: {
        version: 3,
        connections,
        devices: [],
        points: [],
        framesByConnection: frames,
        configVersion,
      },
    },
    health,
  }
  // Pass `serialSources: undefined` to omit the key (matches several pause/COM suites).
  if ('serialSources' in opts) {
    if (opts.serialSources !== undefined) payload.serialSources = opts.serialSources
  } else {
    payload.serialSources = [SOURCE_C1]
  }
  return payload
}

/** Force the fallback (non-vendor) Frames row path for deterministic HappyDOM rows. */
export async function withNullVendor(fn) {
  const saved = globalThis.DvbVendor
  globalThis.DvbVendor = null
  try {
    return await fn()
  } finally {
    globalThis.DvbVendor = saved
  }
}

export function makePost({ frames = {}, openCalls = [], closeCalls = [], serialSources, connections, stateFn } = {}) {
  const calls = { state: 0, open: 0, close: 0, evidence: 0, clear: 0, feed: 0 }
  const conns = connections || [
    { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
  ]
  const sources =
    serialSources !== undefined ? serialSources : [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }]
  const post = async (path, body) => {
    if (path === '/dsh-vision-bench/state') {
      calls.state++
      const mb = {
        version: 3,
        connections: conns,
        devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
        points: [],
        framesByConnection: frames,
        configVersion: 7,
      }
      return {
        ok: true,
        workspace: { modbus: mb },
        health: { python: { bound: true, exists: true } },
        serialSources: sources,
      }
    }
    if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3'] }
    if (path === '/dsh-vision-bench/serial/open') {
      calls.open++
      openCalls.push(body)
      return { ok: false, error: 'USE_HMI_CONNECT' }
    }
    if (path === '/dsh-vision-bench/serial/close') {
      calls.close++
      closeCalls.push(body)
      return { ok: true }
    }
    if (path === '/dsh-vision-bench/connection/open') {
      calls.open++
      openCalls.push(body)
      return { ok: true }
    }
    if (path === '/dsh-vision-bench/connection/close') {
      calls.close++
      closeCalls.push(body)
      return { ok: true }
    }
    if (path === '/dsh-vision-bench/serial/feed') {
      calls.feed++
      return { ok: true, open: true, error: '', lastId: 1, lines: [] }
    }
    if (path === '/dsh-vision-bench/frames/clear') {
      calls.clear++
      return { ok: true, cleared: (body && body.connectionId) || 'all' }
    }
    if (path === '/dsh-vision-bench/evidence') {
      calls.evidence++
      return { ok: true, evidence: [] }
    }
    if (stateFn) return stateFn(path, body)
    return { ok: true }
  }
  return { post, calls, openCalls, closeCalls }
}

export const framesT = (k) =>
  ({
    framesRaw: '原始数据',
    framesProto: '协议报文',
    framesClearView: '清空显示',
    serialPause: '暂停',
    serialResume: '恢复',
    framesClear: '清空',
    framesCopyHex: '复制',
    serialCopied: '已复制',
    framesExport: '导出',
    framesTab: '串口报文',
    framesEmpty: '暂无报文',
    serialFilter: '过滤',
    openInHmi: '在上位机打开',
    framesAll: '全部串口',
    framesGoHmi: '前往上位机',
    framesNoLink: '暂无已连接串口',
  })[k] || k
