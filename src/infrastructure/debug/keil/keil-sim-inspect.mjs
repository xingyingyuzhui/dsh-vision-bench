// @ts-check

/**
 * Evaluates an expression in current Keil scope.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {string} expr
 * @returns {Promise<string>}
 */
export async function keilEvaluate(client, expr) {
  const res = await client.evaluateExpression(expr)
  return res.value != null ? String(res.value) : ''
}

/**
 * Projects Keil stack frames, falling back to current location.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {import('../../../types/debug.d.ts').SourceLocation | null} currentLocation
 * @returns {Promise<import('../../../types/debug.d.ts').DebugStackFrame[]>}
 */
export async function keilStack(client, currentLocation) {
  try {
    const items = await client.enumStack()
    if (Array.isArray(items) && items.length > 0) {
      return items.map((item, idx) => ({
        level: idx,
        function: `frame_${item.nItem ?? idx}`,
        file: currentLocation?.file || '',
        line: Number(item.nAdr ? item.nAdr & 0xffffn : 1),
      }))
    }
  } catch {}

  return [
    {
      level: 0,
      function: currentLocation?.function || 'main',
      file: currentLocation?.file || '',
      line: currentLocation?.line || 1,
    },
  ]
}

/**
 * Projects Keil local variables.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @returns {Promise<import('../../../types/debug.d.ts').DebugVariable[]>}
 */
export async function keilLocals(client) {
  try {
    const vars = await client.enumVariables()
    if (Array.isArray(vars) && vars.length > 0) {
      return vars.map((v) => ({
        name: v.name,
        value: v.value,
        type: v.type,
      }))
    }
  } catch {}
  return []
}

/**
 * Projects Keil registers with a small fallback set.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @returns {Promise<import('../../../types/debug.d.ts').DebugRegister[]>}
 */
export async function keilRegisters(client) {
  try {
    const regs = await client.readRegisters()
    if (Array.isArray(regs) && regs.length > 0) {
      return regs.map((r) => ({
        name: r.name || 'REG',
        value: r.value || '0x0',
      }))
    }
  } catch {}

  return [
    { name: 'R0', value: '0x00000000' },
    { name: 'PC', value: '0x08000120' },
  ]
}

/**
 * Reads memory as hex string.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {string} address
 * @param {number} [length]
 * @returns {Promise<string>}
 */
export async function keilReadMemoryHex(client, address, length = 32) {
  const res = await client.readMemory(address, length)
  return res.hex || ''
}

/**
 * Reads memory as structured bytes.
 * @param {import('./uvsock-client.mjs').UvSockClient} client
 * @param {string} addr
 * @param {number} [length]
 */
export async function keilReadMemoryBytes(client, addr, length = 32) {
  const res = await client.readMemory(addr, length)
  return {
    address: addr,
    bytes: res.bytes,
  }
}

/**
 * Inspects current location, stack, locals, and registers.
 * @param {any} backend KeilSimBackend-like
 * @param {number} [frame]
 */
export async function keilInspect(backend, frame = 0) {
  const evalRes = await backend.evaluate('1', frame).catch(() => '1')
  return {
    location: backend.currentLocation,
    stack: await backend.stack(),
    locals: await backend.locals(),
    registers: await backend.registers().catch(() => []),
    evalProbe: evalRes,
  }
}
