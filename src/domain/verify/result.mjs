// @ts-check

/**
 * Creates a structured VerifyResult object from evaluated assertions and evidence.
 *
 * @param {{
 *   scenario: { id: string, name: string },
 *   assertions: import('../../types/verify.d.ts').AssertionResult[],
 *   durationMs?: number,
 *   evidence?: Array<Record<string, any>>,
 *   error?: any,
 * }} params
 * @returns {import('../../types/verify.d.ts').VerifyResult}
 */
export function createVerifyResult(params) {
  const { scenario, assertions = [], durationMs = 0, evidence = [], error } = params
  const totalCount = assertions.length
  const passedCount = assertions.filter((a) => a.pass).length
  const failedCount = totalCount - passedCount

  /** @type {import('../../types/verify.d.ts').VerifyStatus} */
  let status = 'pass'
  if (error) {
    status = 'error'
  } else if (failedCount > 0) {
    status = 'fail'
  }

  let summary = ''
  if (status === 'error') {
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
    scenarioId: scenario.id,
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
  }
}
