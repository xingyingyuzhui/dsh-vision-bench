// @ts-check
import { localPersonaConfigReplica } from './dsh-contract.mjs'

/**
 * @param {unknown} node
 * @returns {Record<string, unknown>}
 */
export function yamlNodeToPlain(node) {
  if (node == null) return {}
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return {}
  }
  if (typeof node === 'object' && typeof (/** @type {{ toJSON?: () => unknown }} */ (node).toJSON) === 'function') {
    const json = /** @type {{ toJSON: () => unknown }} */ (node).toJSON()
    return json && typeof json === 'object' && !Array.isArray(json) ? /** @type {Record<string, unknown>} */ (json) : {}
  }
  if (typeof node === 'object' && !Array.isArray(node)) return { .../** @type {Record<string, unknown>} */ (node) }
  return {}
}

/**
 * @param {unknown} node
 * @param {string} key
 */
export function yamlMapGet(node, key) {
  if (!node || typeof node !== 'object') return undefined
  if (typeof (/** @type {{ get?: Function }} */ (node).get) === 'function') {
    return /** @type {{ get: (k: string) => unknown }} */ (node).get(key)
  }
  return /** @type {Record<string, unknown>} */ (node)[key]
}

/**
 * @param {unknown} config
 * @param {(value: unknown) => unknown} [schema]
 */
export function validatePersonaConfig(config, schema = localPersonaConfigReplica) {
  return schema(config)
}

/**
 * Validate every persona row in a composition sequence. Does not evaluate `!!js`.
 *
 * @param {{ items?: unknown[] } | null | undefined} seq
 * @param {(value: unknown) => unknown} [schema]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateCompositionPersona(seq, schema = localPersonaConfigReplica) {
  const items = seq && Array.isArray(seq.items) ? seq.items : []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const id = yamlMapGet(item, 'id')
    const name = yamlMapGet(item, 'name')
    const isPersona = id === 'persona' || (typeof name === 'string' && name.includes('dsh-persona'))
    if (!isPersona) continue
    const plain = yamlNodeToPlain(yamlMapGet(item, 'config'))
    try {
      validatePersonaConfig(plain, schema)
    } catch (error) {
      return {
        ok: false,
        error: `persona 配置无法通过官方校验（row ${i + 1}）: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  return { ok: true }
}

const HOST_PLUGIN_NAME = 'dsh-vision-bench'
const AGENT_PLUGIN_SPEC = 'dsh-vision-bench/agent'

/**
 * Structural contract for a managed Vision composition: official persona schema
 * plus the agent-plane tool row. Does not evaluate `!!js`.
 *
 * @param {{ items?: unknown[] } | null | undefined} seq
 * @param {(value: unknown) => unknown} [schema]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateManagedVisionComposition(seq, schema = localPersonaConfigReplica) {
  const persona = validateCompositionPersona(seq, schema)
  if (!persona.ok) return persona
  const items = seq && Array.isArray(seq.items) ? seq.items : []
  let toolRows = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const id = yamlMapGet(item, 'id')
    const name = yamlMapGet(item, 'name')
    const isTool =
      id === 'vision-bench-tools' || name === HOST_PLUGIN_NAME || name === AGENT_PLUGIN_SPEC
    if (!isTool) continue
    toolRows += 1
    if (name !== AGENT_PLUGIN_SPEC) {
      return {
        ok: false,
        error: `vision-bench-tools 必须指向 ${AGENT_PLUGIN_SPEC}（row ${i + 1} 为 ${String(name || '')}）`,
      }
    }
    const plain = yamlNodeToPlain(yamlMapGet(item, 'config'))
    if (plain.role != null) {
      return { ok: false, error: `vision-bench-tools 不应再携带 config.role（row ${i + 1}）` }
    }
  }
  if (toolRows === 0) {
    return { ok: false, error: `缺少 ${AGENT_PLUGIN_SPEC} 工具行` }
  }
  if (toolRows > 1) {
    return { ok: false, error: 'Vision 工具行重复' }
  }
  return { ok: true }
}
