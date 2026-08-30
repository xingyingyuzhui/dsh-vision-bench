// @ts-check
/** @param {any} conn @param {any} dev */
export const endpointFingerprint = (conn, dev) => ({
  mode: conn.mode,
  port: (conn.port || '').trim(),
  baudrate: Number(conn.baudrate) || 0,
  bytesize: Number(conn.bytesize) || 8,
  parity: conn.parity || 'N',
  stopbits: Number(conn.stopbits) || 1,
  host: (conn.host || '').trim(),
  tcpPort: Number(conn.tcpPort) || 0,
  // Unit ID 只属于设备；审批指纹绑定 device.unitId，不再比较 conn.slave
  unitId: Math.min(247, Math.max(0, Math.trunc(Number(dev?.unitId) || 0))),
})

/** @param {any} conn */
export const endpointLabelText = (conn) =>
  conn.mode === 'tcp' ? `${conn.host || '?'}:${conn.tcpPort}` : `${conn.port || '?'} @ ${conn.baudrate}`

/** @param {any} a @param {any} b */
export const sameEndpoint = (a, b) =>
  !!a &&
  !!b &&
  a.mode === b.mode &&
  a.port === b.port &&
  a.baudrate === b.baudrate &&
  a.bytesize === b.bytesize &&
  a.parity === b.parity &&
  a.stopbits === b.stopbits &&
  a.host === b.host &&
  a.tcpPort === b.tcpPort &&
  a.unitId === b.unitId
