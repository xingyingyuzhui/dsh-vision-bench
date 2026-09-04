// @ts-check

/**
 * Compares actual and expected values using the specified operator.
 * Performs numeric coercion when both operands are valid finite numbers.
 *
 * @param {any} actual
 * @param {import('../../types/verify.d.ts').AssertionOperator | string} op
 * @param {any} expected
 * @returns {boolean}
 */
export function evaluateOperator(actual, op, expected) {
  const numActual = Number(actual)
  const numExpected = Number(expected)
  const numeric =
    actual !== null &&
    actual !== '' &&
    expected !== null &&
    expected !== '' &&
    Number.isFinite(numActual) &&
    Number.isFinite(numExpected)

  const a = numeric ? numActual : actual
  const e = numeric ? numExpected : expected

  switch (op) {
    case '==':
      return a === e || String(a) === String(e)
    case '!=':
      return a !== e && String(a) !== String(e)
    case '>':
      return a > e
    case '>=':
      return a >= e
    case '<':
      return a < e
    case '<=':
      return a <= e
    case 'in':
      if (Array.isArray(expected)) {
        return expected.includes(a) || expected.includes(actual)
      }
      return false
    case 'matches':
      try {
        const re = new RegExp(String(expected))
        return re.test(String(actual))
      } catch {
        return false
      }
    default:
      return a === e || String(a) === String(e)
  }
}

/**
 * Evaluates a single assertion spec against actual collected data.
 *
 * @param {import('../../types/verify.d.ts').AssertionSpec} spec
 * @param {any} actualValue
 * @returns {import('../../types/verify.d.ts').AssertionResult}
 */
export function evaluateAssertion(spec, actualValue) {
  const id = spec.id || `${spec.type}_${Math.random().toString(36).slice(2, 7)}`
  const now = Date.now()

  switch (spec.type) {
    case 'debug.expression': {
      const op = spec.op || '=='
      const pass = evaluateOperator(actualValue, op, spec.value)
      const desc = spec.description || `Debug 表达式 [${spec.expr || ''}]`
      return {
        id,
        type: spec.type,
        pass,
        actual: actualValue,
        expected: spec.value,
        op,
        message: pass
          ? `${desc} 断言通过 (${actualValue} ${op} ${spec.value})`
          : `${desc} 断言失败: 实际值 ${JSON.stringify(actualValue)} 不满足 ${op} ${JSON.stringify(spec.value)}`,
        timestamp: now,
      }
    }

    case 'modbus.point': {
      const op = spec.op || '=='
      const pass = evaluateOperator(actualValue, op, spec.value)
      const desc = spec.description || `Modbus 点位 [${spec.pointId || ''}]`
      return {
        id,
        type: spec.type,
        pass,
        actual: actualValue,
        expected: spec.value,
        op,
        message: pass
          ? `${desc} 断言通过 (${actualValue} ${op} ${spec.value})`
          : `${desc} 断言失败: 实际值 ${JSON.stringify(actualValue)} 不满足 ${op} ${JSON.stringify(spec.value)}`,
        timestamp: now,
      }
    }

    case 'no.exception': {
      let hasException = false
      if (typeof actualValue === 'boolean') {
        hasException = actualValue
      } else if (Array.isArray(actualValue)) {
        hasException = actualValue.length > 0
      } else if (actualValue && typeof actualValue === 'object') {
        hasException = Boolean(actualValue.hasException || actualValue.exception)
      }
      const pass = !hasException
      return {
        id,
        type: spec.type,
        pass,
        actual: hasException ? (Array.isArray(actualValue) ? actualValue : 'exception-detected') : 'none',
        expected: 'none',
        message: pass ? '无未捕获异常/故障停机' : '检测到异常/硬件故障停机',
        timestamp: now,
      }
    }

    case 'no.alarm': {
      let activeAlarms = 0
      if (typeof actualValue === 'number') {
        activeAlarms = actualValue
      } else if (Array.isArray(actualValue)) {
        activeAlarms = actualValue.length
      } else if (actualValue && typeof actualValue === 'object') {
        activeAlarms = Array.isArray(actualValue.alarms) ? actualValue.alarms.length : 0
      }
      const pass = activeAlarms === 0
      const desc = spec.pointId ? `点位 [${spec.pointId}]` : '工作区'
      return {
        id,
        type: spec.type,
        pass,
        actual: activeAlarms,
        expected: 0,
        op: '==',
        message: pass ? `${desc} 无活跃告警` : `${desc} 存在 ${activeAlarms} 项活跃告警`,
        timestamp: now,
      }
    }

    case 'range': {
      const num = Number(actualValue)
      const min = spec.min != null ? Number(spec.min) : Number.NEGATIVE_INFINITY
      const max = spec.max != null ? Number(spec.max) : Number.POSITIVE_INFINITY
      const pass = Number.isFinite(num) && num >= min && num <= max
      const targetName = spec.expr ? `表达式 [${spec.expr}]` : `点位 [${spec.pointId || ''}]`
      return {
        id,
        type: spec.type,
        pass,
        actual: actualValue,
        expected: `[${min}, ${max}]`,
        message: pass
          ? `${targetName} 数值 ${num} 在期望区间 [${min}, ${max}] 内`
          : `${targetName} 数值 ${num} 超出期望区间 [${min}, ${max}]`,
        timestamp: now,
      }
    }

    case 'changed': {
      let hasChanged = false
      let initVal = undefined
      let curVal = actualValue
      if (actualValue && typeof actualValue === 'object' && 'initial' in actualValue && 'current' in actualValue) {
        initVal = actualValue.initial
        curVal = actualValue.current
        hasChanged = initVal !== curVal
      } else if (typeof actualValue === 'boolean') {
        hasChanged = actualValue
      }
      const pass = hasChanged
      const targetName = spec.expr ? `表达式 [${spec.expr}]` : `点位 [${spec.pointId || ''}]`
      return {
        id,
        type: spec.type,
        pass,
        actual: curVal,
        expected: `changed (from ${initVal})`,
        message: pass
          ? `${targetName} 发生状态变化 (${initVal} -> ${curVal})`
          : `${targetName} 未发生预期变化 (仍为 ${initVal})`,
        timestamp: now,
      }
    }

    case 'stable-for-duration': {
      let isStable = true
      let maxDelta = 0
      const tolerance = spec.tolerance != null ? Number(spec.tolerance) : 0

      if (Array.isArray(actualValue) && actualValue.length > 0) {
        const nums = actualValue.map(Number).filter(Number.isFinite)
        if (nums.length > 1) {
          const min = Math.min(...nums)
          const max = Math.max(...nums)
          maxDelta = max - min
          isStable = maxDelta <= tolerance
        }
      } else if (actualValue && typeof actualValue === 'object' && 'maxDelta' in actualValue) {
        maxDelta = Number(actualValue.maxDelta) || 0
        isStable = maxDelta <= tolerance
      }

      const pass = isStable
      const targetName = spec.expr ? `表达式 [${spec.expr}]` : `点位 [${spec.pointId || ''}]`
      return {
        id,
        type: spec.type,
        pass,
        actual: maxDelta,
        expected: `<= ${tolerance}`,
        op: '<=',
        message: pass
          ? `${targetName} 在持续期间保持稳定 (波动 ${maxDelta} <= 容差 ${tolerance})`
          : `${targetName} 在持续期间波动过大 (波动 ${maxDelta} > 容差 ${tolerance})`,
        timestamp: now,
      }
    }

    default:
      return {
        id,
        type: spec.type,
        pass: false,
        actual: actualValue,
        expected: spec.value,
        message: `不支持的断言类型: ${spec.type}`,
        timestamp: now,
      }
  }
}
