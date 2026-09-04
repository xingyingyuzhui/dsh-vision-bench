// @ts-check

/**
 * Maps native GDB/MI stop record to standardized Vision stop reason.
 * Parity with ADR-013 & Phase 3 Section 7.8.
 *
 * @param {import('./mi-record.mjs').MIRecord | null | undefined} miRecord
 * @returns {'breakpoint' | 'watchpoint' | 'step' | 'signal' | 'exception' | 'pause' | 'exit' | 'unknown'}
 */
export function mapGdbStopReason(miRecord) {
  if (!miRecord) return 'unknown'

  if (miRecord.kind === 'exec-async' && miRecord.class === 'stopped') {
    const reason = String(miRecord.results?.reason || '').trim()

    if (reason === 'breakpoint-hit') return 'breakpoint'
    if (
      reason === 'watchpoint-trigger' ||
      reason === 'read-watchpoint-trigger' ||
      reason === 'access-watchpoint-trigger'
    ) {
      return 'watchpoint'
    }
    if (reason === 'end-stepping-range' || reason === 'function-finished') {
      return 'step'
    }
    if (reason === 'location-reached') return 'breakpoint'

    if (reason === 'signal-received') {
      const sig = String(miRecord.results?.['signal-name'] || '').toUpperCase()
      if (sig === 'SIGINT') return 'pause'
      if (sig === 'SIGTRAP') return 'breakpoint'
      if (sig.includes('BUS') || sig.includes('SEGV') || sig.includes('FPE')) {
        return 'exception'
      }
      return 'signal'
    }

    if (reason === 'exited' || reason === 'exited-normally' || reason === 'exited-signalled') {
      return 'exit'
    }

    if (miRecord.results?.bkptno) return 'breakpoint'
    if (miRecord.results?.wpt) return 'watchpoint'

    // GDB often returns *stopped without a reason string when interrupted
    if (!reason) {
      return 'pause'
    }

    return 'unknown'
  }

  if (miRecord.class === 'exit') {
    return 'exit'
  }

  return 'unknown'
}
