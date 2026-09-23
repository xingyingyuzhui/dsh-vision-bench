// @ts-check
import { finalizeAgentCommandResult } from '../../src/application/commands/lossless-json.mjs'
import { executeHostCommand } from '../../src/application/commands/host-command-service.mjs'

/**
 * @param {any} [input]
 * @returns {{ source: string, sessionId: string }}
 */
const originFrom = (input) => ({
  source: input && input.source === 'agent' ? 'agent' : 'user',
  sessionId: input && input.sessionId ? String(input.sessionId) : '',
})

/**
 * Test helper: calls the Host application layer directly.
 * Production Agent tools must use `visionBenchTool` → `dispatchVisionCommand({ requireHost: true })`.
 * Keeps full Host results (no Agent projection) for business tests.
 * @param {any} [home]
 * @param {any} [args]
 * @param {any} [cwd]
 * @param {any} [originInput]
 * @param {any} [opts]
 * @returns {Promise<any>}
 */
export async function runVisionBench(home, args, cwd, originInput, opts) {
  const origin = originFrom(originInput)
  return finalizeAgentCommandResult(
    await executeHostCommand({
      home,
      cwd,
      action: args && args.action,
      payload: args || {},
      source: origin.source,
      sessionId: origin.sessionId,
      signal: opts && opts.signal,
      commandId: opts && opts.commandId,
      expectedConfigVersion: args && (args.expectedConfigVersion ?? args.configVersion),
      transport: opts && opts.transport,
    }),
    origin.source,
  )
}
