// @ts-check

/**
 * Creates a structured VerifyResult object from evaluated assertions and evidence.
 *
 * @param {{
 *   scenario: { id?: string; name: string },
 *   assertions?: import('../../types/verify.d.ts').AssertionResult[],
 *   durationMs?: number,
 *   evidence?: Array<Record<string, any>>,
 *   error?: any,
 *   status?: import('../../types/verify.d.ts').VerifyStatus,
 *   artifactSha256?: string,
 *   debugSessionId?: string,
 *   firmwareHash?: string,
 *   targetIdentity?: string,
 *   startAt?: number,
 *   endAt?: number,
 *   telemetrySamples?: Array<{ pointId?: string; expr?: string; timestamp: number; value: any }>,
 * }} params
 * @returns {import('../../types/verify.d.ts').VerifyResult}
 */
export function createVerifyResult(params) {
  const {
    scenario,
    assertions = [],
    durationMs = 0,
    evidence = [],
    error,
    artifactSha256,
    debugSessionId,
    firmwareHash,
    targetIdentity,
    startAt,
    endAt,
    telemetrySamples = [],
  } = params

  const totalCount = assertions.length
  const passedCount = assertions.filter((a) => a.pass).length
  const failedCount = totalCount - passedCount

  /** @type {import('../../types/verify.d.ts').VerifyStatus} */
  let status = 'pass'
  if (params.status) {
    status = params.status
  } else if (error) {
    const msg = String(error?.message || error)
    if (msg.includes('TIMEOUT') || msg.includes('timeout')) {
      status = 'timeout'
    } else if (msg.includes('CANCEL') || msg.includes('cancel') || msg.includes('abort')) {
      status = 'cancelled'
    } else {
      status = 'error'
    }
  } else if (failedCount > 0) {
    status = 'fail'
  }

  let summary = ''
  if (status === 'timeout') {
    summary = `验证场景 [${scenario.name}] 超时未完成 (TIMEOUT)`
  } else if (status === 'cancelled') {
    summary = `验证场景 [${scenario.name}] 已被取消 (CANCELLED)`
  } else if (status === 'error') {
    summary = `验证场景 [${scenario.name}] 执行异常: ${error?.message || String(error)} (ERROR)`
  } else if (status === 'pass') {
    summary = `验证场景 [${scenario.name}]: 全部 ${totalCount} 项断言通过 (PASS)`
  } else {
    const failedNames = assertions
      .filter((a) => !a.pass)
      .map((a) => a.id)
      .join(', ')
    summary = `验证场景 [${scenario.name}]: ${passedCount}/${totalCount} 项断言通过，失败项: [${failedNames}] (FAIL)`
  }

  return {
    scenarioId: scenario.id || '',
    scenarioName: scenario.name,
    status,
    passedCount,
    failedCount,
    totalCount,
    durationMs: Math.max(0, Math.round(durationMs)),
    assertions,
    evidence,
    summary,
    timestamp: Date.now(),
    artifactSha256,
    debugSessionId,
    firmwareHash,
    targetIdentity,
    startAt,
    endAt,
    telemetrySamples,
  }
}
