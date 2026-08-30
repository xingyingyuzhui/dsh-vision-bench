// @ts-check
import { validateConnections, validateDevices } from '../../../bench-devices.mjs'

/**
 * @param {any} workspace
 * @returns {any}
 */
export function validateWorkspaceConfig(workspace) {
  const pack = workspace?.modbus || {}
  const errors = []
  for (const item of validateConnections(pack.connections || [], pack.devices || [])) errors.push(item)
  for (const item of validateDevices(pack.devices || [], pack.connections || [])) {
    if (!errors.includes(item)) errors.push(item)
  }
  const points = pack.points || []
  const seen = new Set()
  for (const point of points) {
    const key = `${point.connectionId}\0${point.deviceId}\0${point.function}\0${point.address}`
    if (seen.has(key)) errors.push(`点位地址冲突: ${point.id}`)
    seen.add(key)
    if (!point.id) errors.push('点位缺少 pointId')
  }
  return errors
}
