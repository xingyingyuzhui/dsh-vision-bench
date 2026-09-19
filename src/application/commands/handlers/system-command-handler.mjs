// @ts-check
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VISION_HOST_CLIENT_INSTANCE_ID } from '../../../infrastructure/host/vision-host-client.mjs'

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../package.json'), 'utf8'))

/**
 * Side-effect-free Host probe. Does not touch serial, Modbus, workers, or workspace.
 * @param {any} ctx
 * @returns {Promise<object | null>}
 */
export async function handleSystemCommand(ctx) {
  const action = ctx?.args?.action
  if (action !== 'system.ping') return null
  return {
    ok: true,
    action: 'system.ping',
    data: {
      service: 'dsh-vision-bench',
      version: String(pkg.version || ''),
      transport: ctx?.opts?.transport === 'http' ? 'http' : 'in-process',
      pid: process.pid,
      timestamp: new Date().toISOString(),
      clientInstanceId: VISION_HOST_CLIENT_INSTANCE_ID,
      hostFiber: 'dsh-vision-bench',
    },
  }
}
