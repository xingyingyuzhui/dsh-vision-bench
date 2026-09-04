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
    if (a.type === 'debug.expression' && (!a.expr || typeof a.expr !== 'string')) {
      throw new Error(`第 ${i + 1} 项 debug.expression 断言缺少 expr 表达式`)
    }
    if (a.type === 'modbus.point' && (!a.pointId || typeof a.pointId !== 'string')) {
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
  validateScenario(spec)
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description || '',
    assertions: spec.assertions.map((a, index) => ({
      ...a,
      id: a.id || `assert_${index + 1}_${Math.random().toString(36).slice(2, 6)}`,
    })),
    targetSpec: spec.targetSpec || {},
    setup: spec.setup || {},
  }
}
