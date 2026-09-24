// @ts-check
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VISION_HOST_CLIENT_INSTANCE_ID } from '../../../infrastructure/host/vision-host-client.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * @returns {{ pluginVersion: string, buildId: string, gitSha?: string }}
 */
function readBuildIdentity() {
  const path = join(root, 'build-info.json')
  if (existsSync(path)) {
    try {
      const info = JSON.parse(readFileSync(path, 'utf8'))
      return {
        pluginVersion: String(info.pluginVersion || pkg.version || ''),
        buildId: String(info.buildId || ''),
        gitSha: info.gitSha ? String(info.gitSha) : undefined,
      }
    } catch {
      // fall through
    }
  }
  return {
    pluginVersion: String(pkg.version || ''),
    buildId: '',
  }
}

/**
 * Side-effect-free Host probe. Does not touch serial, Modbus, workers, or workspace.
 * @param {any} ctx
 * @returns {Promise<object | null>}
 */
export async function handleSystemCommand(ctx) {
  const action = ctx?.args?.action
  if (action !== 'system.ping') return null
  const identity = readBuildIdentity()
  return {
    ok: true,
    action: 'system.ping',
    data: {
      service: 'dsh-vision-bench',
      version: identity.pluginVersion || String(pkg.version || ''),
      pluginVersion: identity.pluginVersion || String(pkg.version || ''),
      buildId: identity.buildId,
      gitSha: identity.gitSha,
      transport: ctx?.opts?.transport === 'http' ? 'http' : 'in-process',
      pid: process.pid,
      timestamp: new Date().toISOString(),
      clientInstanceId: VISION_HOST_CLIENT_INSTANCE_ID,
      hostFiber: 'dsh-vision-bench',
    },
  }
}
