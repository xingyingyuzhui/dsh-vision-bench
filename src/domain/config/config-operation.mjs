// @ts-check
export const POINT_OPS = new Set(['add', 'update', 'remove', 'clear'])
export const VIZ_OPS = new Set(['add', 'update', 'remove', 'layout'])
export const CONNECTION_OPS = new Set(['create', 'update', 'remove'])
export const DEVICE_OPS = new Set(['create', 'update', 'remove'])
export const SHARE_OPS = new Set(['update'])

/** Scopes that edit session-scoped topology and therefore need a sessionId once the workspace is partitioned. */
export const SESSION_SCOPED_SCOPES = new Set(['points', 'visualization', 'connection', 'device', 'flags', 'share'])

export const CONFIG_OPERATIONS = new Set([
  ...[...POINT_OPS].map((op) => `points.${op}`),
  ...[...VIZ_OPS].map((op) => `visualization.${op}`),
  ...[...CONNECTION_OPS].map((op) => `connection.${op}`),
  ...[...DEVICE_OPS].map((op) => `device.${op}`),
  'flags.update',
  ...[...SHARE_OPS].map((op) => `share.${op}`),
])

/** @param {unknown} operation */
export function parseOperation(operation) {
  const raw = String(operation || '').trim()
  const [scope, op] = raw.split('.')
  return { raw, scope: scope || '', op: op || '' }
}

/** @param {unknown} value */
export function explicitId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return id || ''
}
