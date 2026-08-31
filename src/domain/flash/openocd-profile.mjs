// @ts-check
import { FLASH_ERROR_CODES } from './errors.mjs'

export const FLASH_INTERFACES = ['cmsis-dap', 'stlink', 'jlink', 'ftdi', 'dap']
export const FLASH_TARGETS = [
  'stm32f1x',
  'stm32f2x',
  'stm32f4x',
  'stm32f7x',
  'stm32g0x',
  'stm32g4x',
  'stm32h7x',
  'stm32l0x',
  'stm32l4x',
  'nrf51',
  'nrf52',
  'rp2040',
  'lpc55',
  'kinetis',
  'efm32',
  'at91samd',
]

export const DEFAULT_OPENOCD_INTERFACE = 'cmsis-dap'
export const DEFAULT_OPENOCD_TARGET = 'stm32f1x'

/** @param {unknown} value */
const present = (value) => value != null && String(value).trim() !== ''

/** @param {unknown} value */
const tokenOf = (value) => String(value || '').trim()

/**
 * Config script names must stay relative basename tokens.
 * @param {string} name
 */
function isSafeCfgToken(name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return false
  if (/[;:"'$[\]{}]/.test(name)) return false
  return /^[a-z0-9][a-z0-9._-]*$/i.test(name)
}

/**
 * @param {unknown} name
 * @returns {{ ok: true, value: string } | { ok: false, errorCode: string, error: string }}
 */
export function validateOpenOcdInterface(name) {
  const raw = tokenOf(name)
  if (!isSafeCfgToken(raw) || !FLASH_INTERFACES.includes(raw)) {
    return { ok: false, errorCode: FLASH_ERROR_CODES.FLASH_INTERFACE_INVALID, error: 'OpenOCD interface 不在白名单内' }
  }
  return { ok: true, value: raw }
}

/**
 * @param {unknown} name
 * @returns {{ ok: true, value: string } | { ok: false, errorCode: string, error: string }}
 */
export function validateOpenOcdTarget(name) {
  const raw = tokenOf(name)
  if (!isSafeCfgToken(raw) || !FLASH_TARGETS.includes(raw)) {
    return { ok: false, errorCode: FLASH_ERROR_CODES.FLASH_TARGET_INVALID, error: 'OpenOCD target 不在白名单内' }
  }
  return { ok: true, value: raw }
}

/**
 * Resolve interface/target from the request, then a previously saved profile, then defaults.
 * Illegal request values are rejected instead of falling back to an unvalidated workspace value.
 *
 * @param {{ interfaceName?: unknown, interface?: unknown, target?: unknown }} [request]
 * @param {{ interface?: unknown, target?: unknown }} [stored]
 * @returns {{ ok: true, interfaceName: string, target: string } | { ok: false, errorCode: string, error: string }}
 */
export function resolveOpenOcdProfile(request = {}, stored = {}) {
  const reqIface = request.interfaceName ?? request.interface
  const reqTarget = request.target
  if (present(reqIface)) {
    const checked = validateOpenOcdInterface(reqIface)
    if (!checked.ok) return checked
  }
  if (present(reqTarget)) {
    const checked = validateOpenOcdTarget(reqTarget)
    if (!checked.ok) return checked
  }
  if (!present(reqIface) && present(stored.interface)) {
    const checked = validateOpenOcdInterface(stored.interface)
    if (!checked.ok) return checked
  }
  if (!present(reqTarget) && present(stored.target)) {
    const checked = validateOpenOcdTarget(stored.target)
    if (!checked.ok) return checked
  }
  return {
    ok: true,
    interfaceName: present(reqIface)
      ? tokenOf(reqIface)
      : present(stored.interface)
        ? tokenOf(stored.interface)
        : DEFAULT_OPENOCD_INTERFACE,
    target: present(reqTarget)
      ? tokenOf(reqTarget)
      : present(stored.target)
        ? tokenOf(stored.target)
        : DEFAULT_OPENOCD_TARGET,
  }
}
