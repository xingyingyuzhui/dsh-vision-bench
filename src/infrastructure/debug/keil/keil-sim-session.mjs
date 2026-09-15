// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
import { UV4DebugProcess } from './uv4-debug-process.mjs'
import { emitKeilBackendEvent, pushKeilRingEvent } from './keil-sim-events.mjs'

/**
 * Starts the Keil Simulator session (optional UV4 spawn + UVSOCK connect).
 *
 * @param {any} backend
 * @param {{
 *   targetSpec?: {
 *     projectPath?: string,
 *     target?: string,
 *     port?: number,
 *     host?: string,
 *     uv4Bin?: string,
 *     firmwareHash?: string,
 *     spawnUv4?: boolean,
 *   },
 * }} [spec]
 */
export async function startKeilSession(backend, spec = {}) {
  backend.state = 'starting'
  const targetSpec = spec.targetSpec || {}
  const projectPath = targetSpec.projectPath || ''
  const target = targetSpec.target || ''
  const host = targetSpec.host || '127.0.0.1'
  let port = targetSpec.port || 5100
  backend.firmwareHash = targetSpec.firmwareHash || ''

  if (!projectPath) {
    throw new Error('启动 Keil 仿真调试必须指定工程文件 (projectPath)')
  }

  if (targetSpec.spawnUv4 && !backend.uv4Process) {
    backend.uv4Process = new UV4DebugProcess({ uv4Bin: targetSpec.uv4Bin })
    const launched = await backend.uv4Process.launch({
      projectPath,
      target,
      preferredPort: port,
      uv4Bin: targetSpec.uv4Bin,
    })
    port = launched.port
  }

  if (!backend.client.connected) {
    await backend.client.connect(host, port)
  }

  await backend.client.loadProject(projectPath)

  if (target) {
    await backend.client.setTarget(target)
  }

  const res = await backend.client.enterDebug()

  backend.state = 'paused'
  backend.currentLocation = res?.location || {
    file: 'main.c',
    line: 1,
    function: 'main',
  }

  pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.SESSION_READY, {
    backend: 'keil-simulator',
    location: backend.currentLocation,
  })

  return {
    ok: true,
    state: backend.state,
    location: backend.currentLocation,
  }
}

/**
 * Stops simulation and cleans up resources.
 * @param {any} backend
 */
export async function stopKeilSession(backend) {
  backend.state = 'stopping'
  try {
    if (backend.client.connected) {
      await backend.client.exitDebug()
    }
  } catch {}

  backend.client.close()

  if (backend.uv4Process) {
    try {
      await backend.uv4Process.stop()
    } catch {}
    backend.uv4Process = null
  }

  backend.state = 'idle'
  pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.SESSION_STOPPED, { backend: 'keil-simulator' })

  emitKeilBackendEvent(backend.listeners, {
    type: 'backend.exited',
    unexpected: false,
  })

  return { ok: true, state: backend.state }
}
