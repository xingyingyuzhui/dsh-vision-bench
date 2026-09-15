// @ts-check

/**
 * Projects GDB stack frames to DebugStackFrame[].
 * @param {import('./mi-client.mjs').MIClient} client
 * @returns {Promise<import('../../../types/debug.d.ts').DebugStackFrame[]>}
 */
export async function gdbStack(client) {
  const rec = await client.command('-stack-list-frames')
  const stack = rec.results?.stack
  if (!Array.isArray(stack)) return []

  return stack.map((item) => {
    const f = item.frame || item
    return {
      level: Number(f.level || 0),
      function: f.func || '??',
      file: f.file || f.fullname || '',
      line: Number(f.line || 0),
      address: f.addr || '',
    }
  })
}

/**
 * Projects GDB locals to DebugVariable[].
 * @param {import('./mi-client.mjs').MIClient} client
 * @returns {Promise<import('../../../types/debug.d.ts').DebugVariable[]>}
 */
export async function gdbLocals(client) {
  const rec = await client.command('-stack-list-variables', ['--all-values'])
  const vars = rec.results?.variables
  if (!Array.isArray(vars)) return []

  return vars.map((v) => ({
    name: v.name || '',
    value: v.value || '',
    type: v.type || '',
  }))
}

/**
 * Evaluates an expression in current GDB scope.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {string} expr
 * @returns {Promise<string>}
 */
export async function gdbEvaluate(client, expr) {
  const rec = await client.command('-data-evaluate-expression', [expr])
  return rec.results?.value || ''
}

/**
 * Projects GDB register names/values to DebugRegister[].
 * @param {import('./mi-client.mjs').MIClient} client
 * @returns {Promise<import('../../../types/debug.d.ts').DebugRegister[]>}
 */
export async function gdbRegisters(client) {
  const namesRec = await client.command('-data-list-register-names')
  const regNames = namesRec.results?.['register-names'] || []

  const valuesRec = await client.command('-data-list-register-values', ['x'])
  const regValues = valuesRec.results?.['register-values'] || []

  /** @type {import('../../../types/debug.d.ts').DebugRegister[]} */
  const registers = []
  if (Array.isArray(regValues)) {
    for (const item of regValues) {
      const num = Number(item.number)
      const name = regNames[num]
      if (name && item.value) {
        registers.push({ name, value: item.value })
      }
    }
  }
  return registers
}

/**
 * Reads raw target memory bytes as hex.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {string} address
 * @param {number} length
 * @returns {Promise<string>}
 */
export async function gdbReadMemory(client, address, length) {
  const rec = await client.command('-data-read-memory-bytes', [address, length])
  const memory = rec.results?.memory
  if (Array.isArray(memory) && memory[0]?.contents) {
    return memory[0].contents
  }
  return ''
}
