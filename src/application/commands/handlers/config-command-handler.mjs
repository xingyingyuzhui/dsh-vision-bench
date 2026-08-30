// @ts-check
import { pointsOp } from '../../../../bench-modbus-forward.mjs'
import { mutateConfig } from '../../config/config-mutation-service.mjs'

/**
 * @param {any} home
 * @param {any} args
 * @param {any} room
 * @param {any} origin
 * @param {any} opts
 */
export async function handleConfigCommand(home, args, room, origin, opts) {
  const action = args?.action
  if (action === 'config') {
    const ran = await mutateConfig({
      home,
      cwd: room.cwd,
      source: origin.source,
      sessionId: origin.sessionId,
      expectedConfigVersion: args.expectedConfigVersion ?? args.configVersion,
      commandId: opts?.commandId,
      operation: args.operation,
      target: args.target || {},
      value: args.value || {},
    })
    return { action, ...ran }
  }
  if (action === 'configureConnection') {
    const ran = await mutateConfig({
      home,
      cwd: room.cwd,
      source: origin.source,
      sessionId: origin.sessionId,
      expectedConfigVersion: args.expectedConfigVersion ?? args.configVersion,
      commandId: opts?.commandId,
      operation: 'connection.update',
      target: { connectionId: args.connectionId || args.connId, deviceId: args.deviceId },
      value: args,
    })
    return { action, ...ran }
  }
  if (action === 'points') {
    const cid =
      typeof args.connectionId === 'string'
        ? args.connectionId
        : typeof args.connId === 'string'
          ? args.connId
          : undefined
    const did = typeof args.deviceId === 'string' ? args.deviceId : undefined
    const op = String(args.op || 'list')
    if (op === 'list') {
      const ran = await pointsOp(home, room.cwd, {
        op: 'list',
        connectionId: cid,
        connId: cid,
        deviceId: did,
      })
      return { action, ...ran }
    }
    const ran = await mutateConfig({
      home,
      cwd: room.cwd,
      source: origin.source,
      sessionId: origin.sessionId,
      expectedConfigVersion: args.expectedConfigVersion ?? args.configVersion,
      commandId: opts?.commandId,
      operation: `points.${op}`,
      target: {
        connectionId: cid,
        deviceId: did,
        pointId: args.id || args.pointId || args.point?.id,
      },
      value: args,
    })
    return { action, ...ran }
  }
  return null
}
