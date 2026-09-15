// @ts-check

/**
 * Adds a Keil breakpoint and records the native id.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {Map<string, string>} breakpointMap
 * @param {import('../../../types/debug.d.ts').DebugBreakpoint} bp
 */
export async function keilAddBreakpoint(client, breakpointMap, bp) {
  const res = await client.createBreakpoint(bp)
  const bpNum = String(res.id || bp.id)
  breakpointMap.set(bp.id, bpNum)
  return { ...bp, verified: true }
}

/**
 * Removes a Keil breakpoint.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {Map<string, string>} breakpointMap
 * @param {string | { id: string }} bpOrId
 */
export async function keilRemoveBreakpoint(client, breakpointMap, bpOrId) {
  const bpId = typeof bpOrId === 'object' && bpOrId !== null ? bpOrId.id : String(bpOrId || '')
  const bpNum = breakpointMap.get(bpId) || bpId
  await client.deleteBreakpoint(bpNum)
  breakpointMap.delete(bpId)
  return true
}

/**
 * Adds a watchpoint via Keil execution command.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {Map<string, string>} watchpointMap
 * @param {import('../../../types/debug.d.ts').DebugWatchpoint} wp
 */
export async function keilAddWatchpoint(client, watchpointMap, wp) {
  await client.executeCommand(`WS ${wp.expression}`)
  const wpNum = String(wp.id)
  watchpointMap.set(wp.id, wpNum)
  return { ...wp, verified: true }
}

/**
 * Removes a Keil watchpoint.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {Map<string, string>} watchpointMap
 * @param {string | { id: string }} wpOrId
 */
export async function keilRemoveWatchpoint(client, watchpointMap, wpOrId) {
  const wpId = typeof wpOrId === 'object' && wpOrId !== null ? wpOrId.id : String(wpOrId || '')
  const wpNum = watchpointMap.get(wpId) || wpId
  await client.executeCommand(`BK ${wpNum}`)
  watchpointMap.delete(wpId)
  return true
}
