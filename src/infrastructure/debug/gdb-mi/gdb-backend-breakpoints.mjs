// @ts-check

/**
 * Sets a GDB breakpoint and records the native number in the map.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {Map<string, string>} breakpointMap
 * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
 */
export async function gdbAddBreakpoint(client, breakpointMap, bp) {
  const loc = `${bp.file}:${bp.line}`
  const args = []
  if (bp.condition) {
    args.push('-c', bp.condition)
  }
  args.push(loc)

  const rec = await client.command('-break-insert', args)
  const bkpt = rec.results?.bkpt
  const bkptNum = bkpt?.number ? String(bkpt.number) : ''
  if (bkptNum) {
    breakpointMap.set(bp.id, bkptNum)
  }
  return {
    ...bp,
    verified: true,
    address: bkpt?.addr,
  }
}

/**
 * Removes a GDB breakpoint.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {Map<string, string>} breakpointMap
 * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
 */
export async function gdbRemoveBreakpoint(client, breakpointMap, bp) {
  const num = breakpointMap.get(bp.id) || bp.id
  await client.command('-break-delete', [num])
  breakpointMap.delete(bp.id)
  return { ok: true }
}

/**
 * Sets a GDB watchpoint.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {Map<string, string>} watchpointMap
 * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
 */
export async function gdbAddWatchpoint(client, watchpointMap, wp) {
  const args = []
  if (wp.accessType === 'read') {
    args.push('-r')
  } else if (wp.accessType === 'readWrite') {
    args.push('-a')
  }
  args.push(wp.expression)

  const rec = await client.command('-break-watch', args)
  const wpt = rec.results?.wpt
  const wptNum = wpt?.number ? String(wpt.number) : ''
  if (wptNum) {
    watchpointMap.set(wp.id, wptNum)
  }
  return {
    ...wp,
    verified: true,
  }
}

/**
 * Removes a GDB watchpoint.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {Map<string, string>} watchpointMap
 * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
 */
export async function gdbRemoveWatchpoint(client, watchpointMap, wp) {
  const num = watchpointMap.get(wp.id) || wp.id
  await client.command('-break-delete', [num])
  watchpointMap.delete(wp.id)
  return { ok: true }
}
