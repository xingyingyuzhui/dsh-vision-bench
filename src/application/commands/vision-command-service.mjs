// @ts-check
import { envelope, normalizeCommand } from './command-contract.mjs'
import { globalCommandIdempotency } from './command-idempotency-cache.mjs'
import { runVisionBench } from './vision-command-router.mjs'

/**
 * Normalize → idempotency → route → envelope.
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function executeVisionCommand(input) {
  const cmd = normalizeCommand(input)
  return globalCommandIdempotency.run(cmd, async () => {
    const args = /** @type {any} */ ({ ...(cmd.payload || {}), action: cmd.action })
    if (cmd.expectedConfigVersion != null && args.expectedConfigVersion == null) {
      args.expectedConfigVersion = cmd.expectedConfigVersion
    }
    const ran = await runVisionBench(
      cmd.home,
      args,
      cmd.cwd,
      {
        source: cmd.source,
        sessionId: cmd.sessionId,
      },
      { signal: cmd.signal, commandId: cmd.commandId },
    )
    return envelope(cmd, ran)
  })
}

export { ACTIONS, runVisionBench, _internal } from './vision-command-router.mjs'
