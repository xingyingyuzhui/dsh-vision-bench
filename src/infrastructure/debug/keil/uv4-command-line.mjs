// @ts-check

/**
 * Builds official Keil UV4 command line arguments for background simulator debugging.
 *
 * @param {{
 *   projectPath: string,
 *   targetName?: string,
 *   socketPort?: number,
 *   hidden?: boolean,
 *   debug?: boolean,
 * }} options
 * @returns {string[]}
 */
export function buildUv4DebugArgs(options) {
  if (!options || !options.projectPath) {
    throw new Error('buildUv4DebugArgs: projectPath is required')
  }

  const args = []

  // -j0 hides dialogs and runs in background/quiet mode
  if (options.hidden !== false) {
    args.push('-j0')
  }

  // -d starts debug session
  if (options.debug !== false) {
    args.push('-d')
  }

  // -s <port> sets UVSOCK server listening port
  if (options.socketPort) {
    args.push('-s', String(options.socketPort))
  }

  // Project path
  args.push(options.projectPath)

  // Target name if provided
  if (options.targetName) {
    args.push('-t', options.targetName)
  }

  return args
}
