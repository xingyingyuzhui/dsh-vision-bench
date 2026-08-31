// @ts-check
import { loadBindings, probeBindings } from '../../../bench-store.mjs'
import { FLASH_ERROR_CODES } from '../../domain/flash/errors.mjs'
import { probeOpenOcdExecutable } from '../../infrastructure/process/openocd-runner.mjs'

/**
 * Shared OpenOCD identity probe used by self-check and the debug page.
 * @param {string} home
 * @param {{ runExecFile?: (bin: any, args: any, opts?: {}) => Promise<any> }} [opts]
 */
export async function probeOpenOcdHealth(home, opts = {}) {
  const bindings = loadBindings(home)
  const probed = /** @type {{ openocd?: { bound?: boolean, exists?: boolean } }} */ (probeBindings(bindings))
  const openocd = probed.openocd || { bound: false, exists: false }
  if (!openocd.bound) {
    return {
      ok: true,
      ready: false,
      bound: false,
      exists: false,
      errorCode: FLASH_ERROR_CODES.OPENOCD_NOT_FOUND,
      reason: '未绑定 OpenOCD',
      versionLine: '',
    }
  }
  if (!openocd.exists) {
    return {
      ok: true,
      ready: false,
      bound: true,
      exists: false,
      errorCode: FLASH_ERROR_CODES.OPENOCD_NOT_FOUND,
      reason: 'OpenOCD 路径不存在',
      versionLine: '',
    }
  }
  const probe = await probeOpenOcdExecutable(bindings.openocd, { runExecFile: opts.runExecFile })
  return {
    ok: true,
    ready: probe.ok === true,
    bound: true,
    exists: true,
    errorCode: probe.ok ? undefined : probe.errorCode,
    reason: probe.ok ? '外部 OpenOCD 可执行文件，由插件通过 Node 进程封装调用' : probe.error || 'OpenOCD 探测失败',
    versionLine: probe.versionLine || '',
    cancelled: probe.cancelled === true,
  }
}
