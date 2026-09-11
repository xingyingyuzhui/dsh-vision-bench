// @ts-check
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** DSH contract this plugin's preset migrator and standing guard are tested against. */
export const SUPPORTED_DSH_CONTRACT = '0.1.5-rc.1'

const require = createRequire(import.meta.url)

/**
 * @param {string[]} [extra]
 * @returns {string[]}
 */
export function dshSearchPaths(extra = []) {
  return [
    ...extra,
    process.env.DSH_PACKAGE_ROOT || '',
    '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh',
    '/opt/homebrew/Cellar/node@24/24.18.0/lib/node_modules/@deepseek-ai/dsh',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh',
  ].filter(Boolean)
}

/**
 * @param {string} specifier
 * @param {string[]} [extraPaths]
 * @returns {string}
 */
export function resolveDshModule(specifier, extraPaths = []) {
  const paths = dshSearchPaths(extraPaths)
  try {
    return require.resolve(specifier, { paths: [...paths, ...(require.resolve.paths(specifier) || [])] })
  } catch (error) {
    const err = new Error(
      `无法解析 ${specifier}（需要 DSH ${SUPPORTED_DSH_CONTRACT}）: ${error instanceof Error ? error.message : String(error)}`,
    )
    err.cause = error
    throw err
  }
}

/**
 * @param {string} [explicit]
 * @param {string[]} [extraPaths]
 * @returns {string}
 */
export function resolveShippedStandardDir(explicit, extraPaths = []) {
  if (explicit) return explicit
  const main = resolveDshModule('@deepseek-ai/dsh-agent-presets', extraPaths)
  return join(dirname(main), '..', 'presets', 'standard')
}

/**
 * Local replica of `@deepseek-ai/dsh-persona` Config required fields.
 * Official schema is used whenever DSH is installed; this replica exists so
 * overlay unit tests still catch `text`-only configs without swallowing errors.
 *
 * @param {unknown} value
 */
export function localPersonaConfigReplica(value) {
  const row = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null
  if (!row || typeof row.prefix !== 'string' || row.prefix === '') {
    throw new Error('$.prefix missing required value')
  }
  return {
    prefix: row.prefix,
    suffix: typeof row.suffix === 'string' ? row.suffix : '',
    complete: typeof row.complete === 'boolean' ? row.complete : false,
    includeRuntimeContext: typeof row.includeRuntimeContext === 'boolean' ? row.includeRuntimeContext : true,
    ...row,
  }
}

/**
 * @param {string[]} [extraPaths]
 * @returns {Promise<(value: unknown) => unknown>}
 */
export async function loadOfficialPersonaConfig(extraPaths = []) {
  const href = pathToFileURL(resolveDshModule('@deepseek-ai/dsh-persona', extraPaths)).href
  const mod = await import(href)
  if (typeof mod.Config !== 'function') {
    throw new Error(`dsh-persona 未导出 Config（DSH ${SUPPORTED_DSH_CONTRACT}）`)
  }
  return mod.Config
}
