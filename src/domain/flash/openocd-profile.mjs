// @ts-check
import { FLASH_ERROR_CODES } from './errors.mjs'

/**
 * OpenOCD `interface/<name>.cfg` whitelist.
 *
 * Every entry must correspond to a real `<name>.cfg` in the OpenOCD repository,
 * otherwise the generated `-f interface/<name>.cfg` makes OpenOCD abort with
 * `Can't find interface/<name>.cfg` before it ever touches the target.
 *
 * Verified against BOTH v0.11.0 and v0.12.0 (`tcl/interface/`):
 *
 *   ✅ cmsis-dap.cfg  stlink.cfg  stlink-dap.cfg  stlink-v2.cfg  stlink-v2-1.cfg
 *      jlink.cfg  kitprog.cfg  ft232r.cfg  raspberrypi-native.cfg
 *
 * Removed because they never existed as files:
 *   ❌ ftdi — upstream has a **directory** `interface/ftdi/`, not `ftdi.cfg`
 *   ❌ dap  — no such file in either release
 *
 * Also deliberately NOT added:
 *   ❌ stlink-hla — only exists on master; absent from v0.11.0 and v0.12.0
 *
 * ## ST-Link driver choice
 *
 * `stlink.cfg` uses the legacy HLA layer (`adapter driver hla`) and upstream
 * recommends ST-LINK/V2 firmware >= V2.J21.S4 when using it.
 *
 * `stlink-dap.cfg` uses the modern direct driver (`adapter driver st-link`,
 * "dapdirect") and supports ST-LINK/V1, V2, V2-1 and V3 — but its own header
 * notes that ST-LINK/V1 and pre-V2J24 V2 units do **not** support dapdirect.
 *
 * Both are offered so a probe whose firmware dislikes one driver can use the
 * other; neither is a substitute for upgrading OpenOCD itself.
 */
export const FLASH_INTERFACES = [
  'cmsis-dap',
  'stlink',
  'stlink-dap',
  'stlink-v2',
  'stlink-v2-1',
  'jlink',
  'kitprog',
  'ft232r',
  'raspberrypi-native',
]

/**
 * Interfaces removed from the whitelist, mapped to a working replacement.
 *
 * A profile saved by an older version may still name one of these. Falling back
 * to a real interface keeps the workspace usable, where returning
 * `FLASH_INTERFACE_INVALID` would strand it on a value the user cannot even see
 * anymore.
 *
 * @type {Record<string, string>}
 */
export const LEGACY_INTERFACE_ALIASES = {
  dap: 'cmsis-dap',
  ftdi: 'ft232r',
}

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
  // Map a legacy token (e.g. `dap`, `ftdi`) onto a real interface before
  // validating, so profiles saved by older versions keep working.
  const resolved = LEGACY_INTERFACE_ALIASES[raw] || raw
  if (!isSafeCfgToken(resolved) || !FLASH_INTERFACES.includes(resolved)) {
    return { ok: false, errorCode: FLASH_ERROR_CODES.FLASH_INTERFACE_INVALID, error: 'OpenOCD interface 不在白名单内' }
  }
  return { ok: true, value: resolved }
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
  // Resolve through the validators so a legacy alias (e.g. `dap` -> `cmsis-dap`)
  // yields the real interface name rather than the token the user saved.
  // Note: a stored value that is invalid for any *other* reason still fails
  // closed — the workspace profile is attacker-writable data, and silently
  // substituting a default would mean flashing an unintended chip.
  return {
    ok: true,
    interfaceName: present(reqIface)
      ? /** @type {{ ok: true, value: string }} */ (validateOpenOcdInterface(reqIface)).value
      : present(stored.interface)
        ? /** @type {{ ok: true, value: string }} */ (validateOpenOcdInterface(stored.interface)).value
        : DEFAULT_OPENOCD_INTERFACE,
    target: present(reqTarget)
      ? /** @type {{ ok: true, value: string }} */ (validateOpenOcdTarget(reqTarget)).value
      : present(stored.target)
        ? /** @type {{ ok: true, value: string }} */ (validateOpenOcdTarget(stored.target)).value
        : DEFAULT_OPENOCD_TARGET,
  }
}
