// @ts-check
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** DSH contract this plugin's preset migrator and standing guard are tested against. */
export const SUPPORTED_DSH_CONTRACT = '0.1.7-alpha.2'

const require = createRequire(import.meta.url)

/**
 * Prefix install of `@deepseek-ai/dsh` next to the Node binary that is running.
 * Unix prefixes keep modules in `../lib/node_modules`; Windows keeps them beside `node.exe`.
 *
 * @param {string} [execPath]
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function dshPackageRootFromExecPath(execPath = process.execPath, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const binDir = pathApi.dirname(execPath)
  if (platform === 'win32') return pathApi.join(binDir, 'node_modules', '@deepseek-ai', 'dsh')
  return pathApi.join(binDir, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh')
}

/**
 * @param {string[]} [extra]
 * @returns {string[]}
 */
export function dshSearchPaths(extra = []) {
  return [
    ...extra,
    process.env.DSH_PACKAGE_ROOT || '',
    dshPackageRootFromExecPath(),
    '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh',
  ].filter(Boolean)
}

/**
 * @param {string} specifier
 * @param {string[]} paths
 * @returns {string}
 */
function resolveFrom(specifier, paths) {
  return require.resolve(specifier, { paths })
}

/**
 * @param {string} specifier
 * @param {string[]} paths
 * @returns {boolean}
 */
function canResolve(specifier, paths) {
  try {
    resolveFrom(specifier, paths)
    return true
  } catch {
    return false
  }
}

/**
 * @param {{ registry: boolean, presets: boolean }} found
 * @returns {'declarative' | 'legacy' | 'unknown'}
 */
function classifyPresetTrack(found) {
  if (!found.registry && !found.presets) return 'unknown'
  if (found.registry && !found.presets) return 'declarative'
  return 'legacy'
}

/**
 * Which preset contract an installed DSH exposes.
 * A non-empty `extraPaths` list is the complete set of resolution roots so a
 * fixture is not mixed with this machine's DSH. An empty list probes install
 * prefixes first; the plugin's own `node_modules` is only a fallback, so a
 * vendored 0.1.6 package does not hide a 0.1.7 prefix install.
 *
 * @param {string[]} [extraPaths]
 * @returns {'declarative' | 'legacy' | 'unknown'}
 */
export function detectPresetTrack(extraPaths = []) {
  if (extraPaths.length > 0) {
    return classifyPresetTrack({
      registry: canResolve('@deepseek-ai/dsh-agent-preset-registry', extraPaths),
      presets: canResolve('@deepseek-ai/dsh-agent-presets', extraPaths),
    })
  }
  const installPaths = dshSearchPaths()
  const installed = classifyPresetTrack({
    registry: canResolve('@deepseek-ai/dsh-agent-preset-registry', installPaths),
    presets: canResolve('@deepseek-ai/dsh-agent-presets', installPaths),
  })
  if (installed !== 'unknown') return installed
  const fallback = require.resolve.paths('@deepseek-ai/dsh-agent-presets') || []
  return classifyPresetTrack({
    registry: canResolve('@deepseek-ai/dsh-agent-preset-registry', fallback),
    presets: canResolve('@deepseek-ai/dsh-agent-presets', fallback),
  })
}

/**
 * Installed `@deepseek-ai/dsh` version, or '' when the package cannot be read.
 * `extraPaths` are searched first, ahead of the install prefixes.
 *
 * @param {string[]} [extraPaths]
 * @returns {string}
 */
export function readInstalledDshVersion(extraPaths = []) {
  try {
    const pkgPath = resolveDshModule('@deepseek-ai/dsh/package.json', extraPaths)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return pkg && typeof pkg.version === 'string' ? pkg.version : ''
  } catch {
    return ''
  }
}

/**
 * @param {string} specifier
 * @param {string[]} [extraPaths]
 * @returns {string}
 */
export function resolveDshModule(specifier, extraPaths = []) {
  const paths = dshSearchPaths(extraPaths)
  try {
    return resolveFrom(specifier, [...paths, ...(require.resolve.paths(specifier) || [])])
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
  return path.join(path.dirname(main), '..', 'presets', 'standard')
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
