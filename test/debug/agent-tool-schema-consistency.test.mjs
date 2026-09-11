// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIONS, visionBenchTool } from '../../bench-tool.mjs'

const tool = visionBenchTool('/tmp/fake-home')
const props = tool.parameters.properties

/**
 * Minimal JSON-Schema walker covering the constraints this tool actually uses:
 * `required`, `additionalProperties: false`, and `enum`. Enough to prove that a
 * well-formed call is accepted and a malformed one is rejected.
 *
 * @param {any} schema
 * @param {any} value
 * @param {string} [path]
 * @returns {string[]} list of violations
 */
function validate(schema, value, path = '$') {
  const errors = []
  if (!schema || typeof schema !== 'object') return errors
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path} 应为 object`]
    }
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key} 缺失（required）`)
    }
    const known = schema.properties || {}
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in known)) errors.push(`${path}.${key} 不被 schema 允许（additionalProperties:false）`)
      }
    }
    for (const [key, sub] of Object.entries(known)) {
      if (value[key] !== undefined) errors.push(...validate(sub, value[key], `${path}.${key}`))
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path} 应为 array`]
    for (const [i, item] of value.entries()) {
      errors.push(...validate(schema.items, item, `${path}[${i}]`))
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} 取值 ${JSON.stringify(value)} 不在 enum 内`)
  }
  return errors
}

test('D2: config 已在 ACTIONS 内', () => {
  assert.ok(ACTIONS.has('config'), 'description 声称适用 config，ACTIONS 必须包含它')
})

test('D2: description 提到的 config 与 enum 不再矛盾', () => {
  assert.match(tool.description, /config/)
  assert.ok(tool.parameters.properties.action.enum.includes('config'))
  assert.deepEqual(tool.parameters.properties.action.enum, [...ACTIONS])
})

test('D2: schema 暴露 config 所需的 value / operation / target', () => {
  assert.ok('value' in props, '缺少 value 会让 config 的变更静默失效')
  assert.ok('operation' in props)
  assert.ok('target' in props)
  assert.equal(props.value.type, 'object')
  assert.equal(props.target.type, 'object')
})

test('D2: additionalProperties 仍为 false（安全姿态未被放宽）', () => {
  assert.equal(tool.parameters.additionalProperties, false)
})

test('D2: 一次完整的 config 调用能通过 schema 校验', () => {
  const call = {
    action: 'config',
    operation: 'connection.create',
    target: { connectionId: 'c2' },
    value: { name: '连接2', mode: 'rtu', port: '/dev/ttyUSB0' },
    expectedConfigVersion: 12,
  }
  assert.deepEqual(validate(tool.parameters, call), [])
})

test('D2: 缺少 action 的调用被 schema 拒绝', () => {
  assert.deepEqual(validate(tool.parameters, { value: {} }), ['$.action 缺失（required）'])
})

test('D2: 未知字段被 schema 拒绝（未放宽 additionalProperties）', () => {
  const errors = validate(tool.parameters, { action: 'status', totallyUnknownField: 1 })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /totallyUnknownField/)
})

test('D2: 非法 action 被 enum 拒绝', () => {
  const errors = validate(tool.parameters, { action: 'not-a-real-action' })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /不在 enum 内/)
})

test('D2: configureConnection 仍走平铺参数（不要求 value）', () => {
  const call = { action: 'configureConnection', connectionId: 'c1', mode: 'tcp', host: '127.0.0.1' }
  assert.deepEqual(validate(tool.parameters, call), [])
})

test('D2: 工具未向 Agent 暴露烧录能力（本轮决策 B 默认不开放）', () => {
  assert.ok(!ACTIONS.has('download'))
  assert.ok(!ACTIONS.has('flash'))
})
