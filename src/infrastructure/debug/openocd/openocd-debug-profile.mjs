// @ts-check
import {
  DEFAULT_OPENOCD_INTERFACE,
  DEFAULT_OPENOCD_TARGET,
  validateOpenOcdInterface,
  validateOpenOcdTarget,
} from '../../../domain/flash/openocd-profile.mjs'

/**
 * Builds OpenOCD launch arguments for GDB server debug session.
 *
 * @param {{
 *   interfaceName?: string,
 *   target?: string,
 *   gdbPort?: number,
 *   tclPort?: number | string,
 *   telnetPort?: number | string,
 * }} options
 * @returns {{ ok: true, args: string[], port: number } | { ok: false, error: string }}
 */
export function buildOpenOcdDebugArgs(options = {}) {
  const ifaceVal = validateOpenOcdInterface(options.interfaceName || DEFAULT_OPENOCD_INTERFACE)
  if (!ifaceVal.ok) return { ok: false, error: ifaceVal.error }

  const targetVal = validateOpenOcdTarget(options.target || DEFAULT_OPENOCD_TARGET)
  if (!targetVal.ok) return { ok: false, error: targetVal.error }

  const port = options.gdbPort || 3333
  const commands = [`gdb_port ${port}`, 'telnet_port disabled', 'tcl_port disabled']

  const args = [
    '-f',
    `interface/${ifaceVal.value}.cfg`,
    '-f',
    `target/${targetVal.value}.cfg`,
    '-c',
    commands.join('; '),
  ]

  return {
    ok: true,
    args,
    port,
  }
}
