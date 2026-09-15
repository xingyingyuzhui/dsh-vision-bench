// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
import { buildSignalFunctionScript } from './debug-script-builder.mjs'
import { emitKeilBackendEvent, pushKeilRingEvent } from './keil-sim-events.mjs'

/**
 * Continues simulator execution.
 * @param {any} backend
 */
export async function keilContinue(backend) {
  backend.state = 'running'
  pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.RUNNING, {})
  emitKeilBackendEvent(backend.listeners, { type: 'backend.running' })

  await backend.client.startExecution()
  return { ok: true, state: 'running' }
}

/**
 * Pauses simulator execution.
 * @param {any} backend
 */
export async function keilPause(backend) {
  const res = await backend.client.stopExecution()
  backend.state = 'paused'
  backend.currentLocation = res?.location || backend.currentLocation

  pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.PAUSED, {
    reason: 'manual',
    location: backend.currentLocation,
  })

  emitKeilBackendEvent(backend.listeners, {
    type: 'backend.stopped',
    reason: 'manual',
    location: backend.currentLocation || undefined,
  })

  return { ok: true, state: 'paused', location: backend.currentLocation }
}

/**
 * Steps simulator by mode.
 * @param {any} backend
 * @param {'into' | 'over' | 'out'} [mode]
 */
export async function keilStep(backend, mode = 'into') {
  backend.state = 'running'
  emitKeilBackendEvent(backend.listeners, { type: 'backend.running' })

  let res = null
  if (mode === 'into') {
    res = await backend.client.stepInto()
  } else if (mode === 'out') {
    res = await backend.client.stepOut()
  } else {
    res = await backend.client.stepOver()
  }

  backend.state = 'paused'
  backend.currentLocation = res?.location || backend.currentLocation

  pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.PAUSED, {
    reason: 'step',
    location: backend.currentLocation,
  })

  emitKeilBackendEvent(backend.listeners, {
    type: 'backend.stopped',
    reason: 'step',
    location: backend.currentLocation || undefined,
  })

  return { ok: true, state: 'paused', location: backend.currentLocation }
}

/**
 * Resets simulator CPU.
 * @param {any} backend
 * @param {'halt' | 'run'} [_mode]
 */
export async function keilReset(backend, _mode = 'halt') {
  const res = await backend.client.reset()
  backend.state = 'paused'
  backend.currentLocation = res?.location || {
    file: 'main.c',
    line: 1,
    function: 'Reset_Handler',
    address: '0x08000000',
  }

  pushKeilRingEvent(backend, DEBUG_EVENT_TYPES.PAUSED, {
    reason: 'reset',
    location: backend.currentLocation,
  })

  emitKeilBackendEvent(backend.listeners, {
    type: 'backend.stopped',
    reason: 'reset',
    location: backend.currentLocation || undefined,
  })

  return { ok: true, state: 'paused', location: backend.currentLocation }
}

/**
 * Applies a Signal Function scenario script.
 * @param {any} backend
 * @param {any} scenario
 */
export async function keilApplyScenario(backend, scenario) {
  const script = buildSignalFunctionScript(scenario)
  await backend.client.executeCommand(script)
  await backend.client.executeCommand(`${scenario.name}()`)
  return { ok: true, scenario: scenario.name }
}

/**
 * Generic command dispatcher for KeilSimBackend.
 * @param {any} ops backend instance with public methods
 * @param {{ type: string, [key: string]: any }} cmd
 */
export async function dispatchKeilCommand(ops, cmd) {
  switch (cmd.type) {
    case 'continue':
    case 'run':
      return ops.continue()
    case 'pause':
      return ops.pause()
    case 'step':
      return ops.step(cmd.stepType)
    case 'resetHalt':
      return ops.resetHalt()
    case 'evaluate':
      return ops.evaluate(cmd.expression)
    case 'stack':
      return ops.stack()
    case 'locals':
      return ops.locals()
    case 'registers':
      return ops.registers()
    case 'readMemory':
      return ops.readMemory(cmd.address, cmd.length)
    case 'addWatchpoint':
      return ops.addWatchpoint(cmd.watchpoint)
    case 'removeWatchpoint':
      return ops.removeWatchpoint(cmd.id || cmd.watchpoint)
    case 'applyScenario':
      return ops.applyScenario(cmd.scenario)
    default:
      throw new Error(`KeilSimBackend 不支持的指令: ${cmd.type}`)
  }
}
