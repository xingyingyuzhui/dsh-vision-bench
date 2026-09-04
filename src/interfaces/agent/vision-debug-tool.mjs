// @ts-check

import { finalizeAgentCommandResult } from '../../application/commands/lossless-json.mjs'
import { dispatchVisionDebugCommand } from '../../infrastructure/host/vision-host-client.mjs'

export const DEBUG_TOOL_ACTIONS = new Set([
  'status',
  'start',
  'stop',
  'run',
  'pause',
  'step',
  'breakpoint',
  'watchpoint',
  'inspect',
  'evaluate',
  'snapshot',
  'reset',
])

/**
 * @param {any} agent
 * @returns {string}
 */
export const cwdOf = (agent) => {
  const session = agent?.session
  const header = session?.header
  return header?.cwd ? String(header.cwd) : ''
}

/**
 * @param {any} agent
 * @returns {string}
 */
export const sessionIdOf = (agent) => {
  const session = agent?.session
  const header = session?.header
  if (header?.id) return String(header.id)
  if (session?.id) return String(session.id)
  return ''
}

/**
 * Factory for the `vision_debug` agent tool.
 * Provides isolated firmware runtime debugging capabilities without raw GDB/OpenOCD exposure.
 * Parity with ADR-013 & Phase 5 Section 9.2.
 *
 * @param {string} home
 */
export function visionDebugTool(home) {
  return {
    name: 'vision_debug',
    description:
      'Firmware runtime debugging tool. Controls and inspects embedded targets via GDB and OpenOCD hardware backend. ' +
      'status: query current debug session, target run state, call stack, breakpoints, and watchpoints. ' +
      'start: start hardware debug session for current workspace firmware artifact. ' +
      'stop: stop active debug session and release hardware probe lease. ' +
      'run: resume target execution (continue). ' +
      'pause: interrupt/halt running target. ' +
      'step: single step (over/into/out). ' +
      'breakpoint: set, remove, or list line/function breakpoints. ' +
      'watchpoint: set data watchpoint on memory expression to catch unexpected modifications. ' +
      'inspect: inspect registers, call stack, local variables, or target memory. ' +
      'evaluate: evaluate C expression in current scope. ' +
      'snapshot: capture forensic snapshot of current target state. ' +
      'reset: reset target CPU and halt.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [...DEBUG_TOOL_ACTIONS],
          description: [...DEBUG_TOOL_ACTIONS].join(' | '),
        },
        backend: {
          type: 'string',
          enum: ['gdb-openocd'],
          description: 'Debug backend (default: gdb-openocd)',
        },
        file: { type: 'string', description: 'Source file for breakpoint' },
        line: { type: 'number', description: 'Source line number for breakpoint' },
        function: { type: 'string', description: 'Function name for breakpoint' },
        expression: { type: 'string', description: 'Expression for watchpoint or evaluate' },
        access: {
          type: 'string',
          enum: ['write', 'read', 'readWrite'],
          description: 'Watchpoint access type (default: write)',
        },
        breakpointId: { type: 'string', description: 'Breakpoint ID to remove' },
        watchpointId: { type: 'string', description: 'Watchpoint ID to remove' },
        stepType: {
          type: 'string',
          enum: ['over', 'into', 'out'],
          description: 'Step mode (default: over)',
        },
        frame: { type: 'number', description: 'Stack frame level for evaluate or inspect' },
        include: {
          type: 'string',
          enum: ['all', 'stack', 'locals', 'registers', 'memory'],
          description: 'Scope of inspection',
        },
        address: { type: 'string', description: 'Memory address to read (e.g. 0x20000000)' },
        length: { type: 'number', description: 'Number of bytes to read from memory' },
        snapshotId: { type: 'string', description: 'Snapshot ID to retrieve or reference' },
        op: { type: 'string', description: 'Sub-operation (e.g. get, list, remove)' },
        reason: { type: 'string', description: 'Reason for diagnostic snapshot' },
        commandId: { type: 'string', description: 'Idempotency key' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      /**
       * @param {any} _args
       * @param {any} value
       */
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 620000,
    /**
     * @param {any} args
     * @param {any} [exec]
     */
    async execute(args, exec) {
      const agent = exec?.agent
      const signal = exec?.signal
      if (signal?.aborted) {
        return finalizeAgentCommandResult({ ok: false, cancelled: true, error: '已取消' }, 'agent')
      }
      return finalizeAgentCommandResult(
        await dispatchVisionDebugCommand({
          home,
          cwd: cwdOf(agent),
          action: args?.action,
          payload: args || {},
          source: 'agent',
          sessionId: sessionIdOf(agent),
          signal,
          commandId: args?.commandId,
          requireHost: true,
        }),
        'agent',
      )
    },
  }
}
