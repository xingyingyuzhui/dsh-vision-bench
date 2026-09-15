// @ts-check

/**
 * Validates bare CLI text for `-interpreter-exec console`.
 * Pre-quoting is silently destructive (double-escaped wire form).
 * @param {string} cliCommand
 * @returns {string}
 */
export function assertBareCliCommand(cliCommand) {
  const raw = String(cliCommand ?? '')
  if (raw.trim().length === 0) {
    throw new Error('interpreterExec 需要非空的 CLI 命令')
  }
  if (/^["'].*["']$/.test(raw.trim())) {
    throw new Error(`interpreterExec 收到已预加引号的参数，请传入裸 CLI 文本: ${raw}`)
  }
  return raw
}

/**
 * Executes a GDB console (CLI) command through `-interpreter-exec`.
 * @param {import('./mi-client.mjs').MIClient} client
 * @param {string} cliCommand bare CLI text, e.g. `monitor reset halt`
 */
export async function gdbInterpreterExec(client, cliCommand) {
  const raw = assertBareCliCommand(cliCommand)
  return client.command('-interpreter-exec', ['console', raw])
}

/**
 * @param {import('./mi-client.mjs').MIClient} client
 */
export async function gdbContinue(client) {
  return client.command('-exec-continue')
}

/**
 * @param {import('./mi-client.mjs').MIClient} client
 */
export async function gdbPause(client) {
  return client.command('-exec-interrupt')
}

/**
 * @param {import('./mi-client.mjs').MIClient} client
 */
export async function gdbStepOver(client) {
  return client.command('-exec-next')
}

/**
 * @param {import('./mi-client.mjs').MIClient} client
 */
export async function gdbStepInto(client) {
  return client.command('-exec-step')
}

/**
 * @param {import('./mi-client.mjs').MIClient} client
 */
export async function gdbStepOut(client) {
  return client.command('-exec-finish')
}

/**
 * @param {import('./mi-client.mjs').MIClient} client
 */
export async function gdbResetHalt(client) {
  return gdbInterpreterExec(client, 'monitor reset halt')
}

/**
 * Generic command dispatcher for DebugBackend command objects.
 * @param {{
 *   continue: () => Promise<any>,
 *   pause: () => Promise<any>,
 *   step: (stepType?: 'over' | 'into' | 'out') => Promise<any>,
 *   resetHalt: () => Promise<any>,
 *   evaluate: (expr: string) => Promise<any>,
 *   stack: () => Promise<any>,
 *   locals: () => Promise<any>,
 *   registers: () => Promise<any>,
 *   readMemory: (address: string, length: number) => Promise<any>,
 *   addWatchpoint: (wp: any) => Promise<any>,
 *   removeWatchpoint: (wp: any) => Promise<any>,
 * }} ops
 * @param {{ type: string, [key: string]: any }} cmd
 */
export async function dispatchGdbCommand(ops, cmd) {
  switch (cmd.type) {
    case 'continue':
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
      return ops.removeWatchpoint(cmd.watchpoint)
    default:
      throw new Error(`未受支持的后端调试命令: ${cmd.type}`)
  }
}
