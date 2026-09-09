// @ts-check
import { DEBUG_EVENT_TYPES } from '../../domain/debug/debug-event.mjs'
import { transition } from '../../domain/debug/debug-state.mjs'
import { DEBUG_ERRORS, DebugError } from '../../domain/debug/errors.mjs'
import { createDebugSnapshot } from '../../domain/debug/snapshot.mjs'

/**
 * Executes a debug command against an active session.
 * @param {any} session
 * @param {{ type: string, [key: string]: any }} command
 * @param {{ onJournalEvent?: ((event: any) => Promise<void>) | null }} [deps]
 */
export async function executeDebugCommand(session, command, deps = {}) {
  const cmdType = command?.type
  const onJournalEvent = deps.onJournalEvent || null

  if (!cmdType) {
    throw new DebugError(DEBUG_ERRORS.COMMAND_REJECTED, '缺少调试命令类型')
  }

  switch (cmdType) {
    case 'continue': {
      if (session.backend?.continue) await session.backend.continue()
      if (!session.backend?.subscribe) {
        session.state = transition(session.state, 'running')
        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.RUNNING,
        })
      }
      return { ok: true, state: session.state }
    }

    case 'pause': {
      if (session.backend?.subscribe) {
        session.pendingExecution = { type: 'pause' }
        if (session.backend.requestPause) {
          await session.backend.requestPause()
        } else if (session.backend.pause) {
          await session.backend.pause()
        }
        return { ok: true, state: session.state, pending: true }
      }
      if (session.backend?.pause) await session.backend.pause()
      session.state = transition(session.state, 'paused')
      session.eventRing.push({
        debugSessionId: session.debugSessionId,
        ownerSessionId: session.ownerSessionId,
        workspaceCwd: session.workspaceCwd,
        backend: session.backendKind,
        type: DEBUG_EVENT_TYPES.PAUSED,
      })
      return { ok: true, state: session.state }
    }

    case 'step': {
      const stepType = command.stepType || 'over'
      if (session.backend?.subscribe) {
        session.pendingExecution = { type: 'step', stepType }
        if (stepType === 'into' && session.backend.stepInto) {
          await session.backend.stepInto()
        } else if (stepType === 'out' && session.backend.stepOut) {
          await session.backend.stepOut()
        } else if (stepType === 'over' && session.backend.stepOver) {
          await session.backend.stepOver()
        } else if (session.backend.step) {
          await session.backend.step(stepType)
        }
        return { ok: true, state: session.state, pending: true }
      }
      if (session.backend?.step) {
        await session.backend.step(stepType)
      }
      session.state = transition(session.state, 'paused')
      session.eventRing.push({
        debugSessionId: session.debugSessionId,
        ownerSessionId: session.ownerSessionId,
        workspaceCwd: session.workspaceCwd,
        backend: session.backendKind,
        type: DEBUG_EVENT_TYPES.STEP_COMPLETE,
        payload: { stepType },
      })
      return { ok: true, state: session.state }
    }

    case 'snapshot': {
      const wantedId = command.snapshotId || command.id
      if (command.op === 'get' || (wantedId && !command.reason)) {
        const hit = session.snapshots.find((/** @type {any} */ s) => s.id === wantedId)
        if (!hit) {
          return { ok: false, errorCode: DEBUG_ERRORS.NOT_FOUND, error: `快照不存在: ${wantedId}` }
        }
        return { ok: true, snapshot: hit }
      }

      let regs = undefined
      if (session.backend?.registers) {
        try {
          regs = await session.backend.registers()
        } catch {}
      }

      const fwHash =
        command.firmwareHash ||
        session.backend?.firmwareHash ||
        session.targetSpec?.artifactSha256 ||
        session.targetSpec?.firmwareHash ||
        ''

      const snap = createDebugSnapshot({
        reason: command.reason || 'manual',
        location: session.location,
        stack: session.stack,
        locals: session.variables,
        watches: command.watches || [],
        registers: regs,
        firmwareHash: fwHash,
        backend: session.backendKind,
        breakpointId: command.breakpointId,
        watchpointId: command.watchpointId,
      })
      session.snapshots.push(snap)
      session.eventRing.push({
        debugSessionId: session.debugSessionId,
        ownerSessionId: session.ownerSessionId,
        workspaceCwd: session.workspaceCwd,
        backend: session.backendKind,
        type: DEBUG_EVENT_TYPES.SNAPSHOT_CREATED,
        payload: { snapshotId: snap.id },
      })
      if (onJournalEvent) {
        await onJournalEvent({
          action: 'snapshot-created',
          ok: true,
          summary: `调试诊断快照已创建: ${snap.id} (${snap.reason})`,
          cwd: session.workspaceCwd,
          sessionId: session.ownerSessionId,
          debugSessionId: session.debugSessionId,
          snapshotId: snap.id,
          location: snap.location,
          firmwareHash: snap.firmwareHash,
        }).catch(() => {})
      }
      return { ok: true, snapshot: snap }
    }

    case 'addBreakpoint': {
      const bpId = command.id || `bp_${Date.now()}_${session.breakpoints.size + 1}`
      const bp = {
        id: bpId,
        file: command.file,
        line: command.line,
        condition: command.condition,
        verified: true,
      }
      session.breakpoints.set(bpId, bp)
      if (session.backend?.addBreakpoint) {
        await session.backend.addBreakpoint(bp)
      }
      session.eventRing.push({
        debugSessionId: session.debugSessionId,
        ownerSessionId: session.ownerSessionId,
        workspaceCwd: session.workspaceCwd,
        backend: session.backendKind,
        type: DEBUG_EVENT_TYPES.BREAKPOINT_CREATED,
        payload: bp,
      })
      return { ok: true, breakpoint: bp }
    }

    case 'removeBreakpoint': {
      const bp = session.breakpoints.get(command.id)
      if (bp) {
        session.breakpoints.delete(command.id)
        if (session.backend?.removeBreakpoint) {
          await session.backend.removeBreakpoint(bp)
        }
        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.BREAKPOINT_REMOVED,
          payload: { id: command.id },
        })
      }
      return { ok: true, removed: Boolean(bp) }
    }

    case 'addWatchpoint': {
      const wpId = command.id || `wp_${Date.now()}_${session.watchpoints.size + 1}`
      const wp = {
        id: wpId,
        expression: command.expression,
        accessType: command.accessType || command.access || 'write',
        verified: true,
      }
      session.watchpoints.set(wpId, wp)
      if (session.backend?.addWatchpoint) {
        await session.backend.addWatchpoint(wp)
      }
      session.eventRing.push({
        debugSessionId: session.debugSessionId,
        ownerSessionId: session.ownerSessionId,
        workspaceCwd: session.workspaceCwd,
        backend: session.backendKind,
        type: DEBUG_EVENT_TYPES.WATCHPOINT_CREATED,
        payload: wp,
      })
      return { ok: true, watchpoint: wp }
    }

    case 'removeWatchpoint': {
      const wp = session.watchpoints.get(command.id)
      if (wp) {
        session.watchpoints.delete(command.id)
        if (session.backend?.removeWatchpoint) {
          await session.backend.removeWatchpoint(wp)
        }
        session.eventRing.push({
          debugSessionId: session.debugSessionId,
          ownerSessionId: session.ownerSessionId,
          workspaceCwd: session.workspaceCwd,
          backend: session.backendKind,
          type: DEBUG_EVENT_TYPES.WATCHPOINT_REMOVED,
          payload: { id: command.id },
        })
      }
      return { ok: true, removed: Boolean(wp) }
    }

    case 'reset':
    case 'resetHalt': {
      if (session.backend?.resetHalt) {
        await session.backend.resetHalt()
      }
      session.state = transition(session.state, 'paused')
      session.eventRing.push({
        debugSessionId: session.debugSessionId,
        ownerSessionId: session.ownerSessionId,
        workspaceCwd: session.workspaceCwd,
        backend: session.backendKind,
        type: DEBUG_EVENT_TYPES.PAUSED,
        payload: { reason: 'reset' },
      })
      return { ok: true, state: session.state }
    }

    case 'evaluate': {
      let value = ''
      if (session.backend?.evaluate) {
        value = await session.backend.evaluate(command.expression)
      }
      return { ok: true, expression: command.expression, value }
    }

    case 'inspect': {
      const include = command.include || 'all'
      if (command.address || include === 'memory') {
        let memory = ''
        if (session.backend?.readMemory && command.address) {
          memory = await session.backend.readMemory(command.address, Number(command.length) || 32)
        }
        return { ok: true, memory, address: command.address }
      }
      const [stack, locals, registers] = await Promise.all([
        session.backend?.stack ? session.backend.stack().catch(() => []) : session.stack,
        session.backend?.locals ? session.backend.locals().catch(() => []) : session.variables,
        session.backend?.registers ? session.backend.registers().catch(() => []) : [],
      ])
      session.stack = stack
      session.variables = locals
      return {
        ok: true,
        location: session.location,
        stack,
        variables: locals,
        registers,
        state: session.state,
      }
    }

    default: {
      if (session.backend && typeof session.backend.command === 'function') {
        const res = await session.backend.command(command)
        return { ok: true, result: res }
      }
      throw new DebugError(DEBUG_ERRORS.COMMAND_REJECTED, `未知的调试命令类型: ${cmdType}`)
    }
  }
}
