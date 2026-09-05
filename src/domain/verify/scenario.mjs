// @ts-check

export const VALID_ASSERTION_TYPES = new Set([
  'debug.expression',
  'modbus.point',
  'no.exception',
  'no.alarm',
  'range',
  'changed',
  'stable-for-duration',
])

/**
 * Validates a Scenario specification.
 * Throws descriptive Error if invalid.
 *
 * @param {any} scenario
 * @returns {asserts scenario is import('../../types/verify.d.ts').ScenarioSpec}
 */
export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') {
    throw new Error('场景配置必须是一个非空对象')
  }

  if (!scenario.id || typeof scenario.id !== 'string') {
    throw new Error('场景配置缺少有效的 id 字段')
  }

  if (!scenario.name || typeof scenario.name !== 'string') {
    throw new Error('场景配置缺少有效的 name 字段')
  }

  if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) {
    throw new Error('场景配置必须包含至少一项断言 (assertions)')
  }

  for (let i = 0; i < scenario.assertions.length; i++) {
    const a = scenario.assertions[i]
    if (!a || typeof a !== 'object') {
      throw new Error(`第 ${i + 1} 项断言不是有效对象`)
    }
    if (!a.type || !VALID_ASSERTION_TYPES.has(a.type)) {
      throw new Error(`第 ${i + 1} 项断言包含未知或未支持的类型: ${a.type}`)
    }
    const expr = a.expr || a.expression || a.source?.expr || a.source?.expression
    if (a.type === 'debug.expression' && (!expr || typeof expr !== 'string')) {
      throw new Error(`第 ${i + 1} 项 debug.expression 断言缺少 expr 表达式`)
    }
    const pointId = a.pointId || a.source?.pointId
    if (a.type === 'modbus.point' && (!pointId || typeof pointId !== 'string')) {
      throw new Error(`第 ${i + 1} 项 modbus.point 断言缺少 pointId 字段`)
    }
  }
}

/**
 * Creates and normalizes a scenario object.
 *
 * @param {import('../../types/verify.d.ts').ScenarioSpec} spec
 * @returns {import('../../types/verify.d.ts').ScenarioSpec}
 */
export function createScenario(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('场景配置必须是一个非空对象')
  }
  const id = spec.id || `scenario_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const normalizedSpec = { ...spec, id }
  validateScenario(normalizedSpec)
  return {
    id,
    name: normalizedSpec.name,
    description: normalizedSpec.description || '',
    timeoutMs: typeof normalizedSpec.timeoutMs === 'number' ? normalizedSpec.timeoutMs : 60000,
    assertions: normalizedSpec.assertions.map((a, index) => {
      const expr = a.expr || a.expression || a.source?.expr || a.source?.expression
      const pointId = a.pointId || a.source?.pointId
      const op = a.op || a.operator || '=='
      const value = a.value !== undefined ? a.value : a.expected
      return {
        ...a,
        id: a.id || `assert_${index + 1}_${Math.random().toString(36).slice(2, 6)}`,
        expr,
        pointId,
        op,
        value,
      }
    }),
    targetSpec: spec.targetSpec || {},
    setup: spec.setup || {},
  }
}
