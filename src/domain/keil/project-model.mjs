// @ts-check

export const MAX_MAP_FILES = 500
export const MAX_MAP_INCLUDES = 80
export const MAX_MAP_DEFINES = 80
export const MAX_MAP_EDGES = 400
export const MAX_FUNCS_FILE = 80
export const MAX_FUNCS_TOTAL = 1200
export const MAX_SOURCE_BYTES = 262144
export const DEFAULT_MAX_RESULTS = 50
export const DEFAULT_MAX_DEPTH = 8

/** @type {Record<string, string>} */
export const FILE_KIND_MAP = {
  '.c': 'c',
  '.cpp': 'c',
  '.cc': 'c',
  '.h': 'h',
  '.hpp': 'h',
  '.s': 'asm',
  '.asm': 'asm',
  '.lib': 'lib',
  '.a': 'lib',
  '.o': 'obj',
  '.obj': 'obj',
}

/**
 * @param {string} nameOrPath
 * @returns {string}
 */
export function kindOfFile(nameOrPath) {
  const dot = nameOrPath.lastIndexOf('.')
  if (dot < 0) return 'other'
  const ext = nameOrPath.slice(dot).toLowerCase()
  return FILE_KIND_MAP[ext] || 'other'
}

/**
 * @param {unknown} raw
 * @returns {{
 *   project: string,
 *   target: string,
 *   groups: Array<{ name: string, files: Array<any> }>,
 *   includes: Array<{ path: string, exists: boolean, inside: boolean }>,
 *   defines: string[],
 *   include_edges: Array<{ from: string, name: string, to: string, resolved: boolean }>,
 *   truncated: { files: boolean, includes: boolean, defines: boolean, include_edges: boolean, functions: boolean },
 *   limits: { files: number, includes: number, defines: number, include_edges: number, functions: number },
 *   counts: { groups: number, files: number, missing: number, unreadable: number, includes: number, defines: number, include_edges: number, functions: number }
 * }}
 */
export function normalizeKeilProjectMap(raw) {
  const obj = /** @type {any} */ (raw && typeof raw === 'object' ? raw : {})
  const project = typeof obj.project === 'string' ? obj.project : ''
  const target = typeof obj.target === 'string' ? obj.target : ''

  const groups = Array.isArray(obj.groups)
    ? /** @type {any[]} */ (obj.groups).map((/** @type {any} */ g) => ({
        name: typeof g?.name === 'string' ? g.name : '组',
        files: Array.isArray(g?.files)
          ? /** @type {any[]} */ (g.files).map((/** @type {any} */ f) => ({
              name: typeof f?.name === 'string' ? f.name : '',
              kind: typeof f?.kind === 'string' ? f.kind : 'other',
              rel: typeof f?.rel === 'string' ? f.rel : '',
              exists: Boolean(f?.exists),
              readable: Boolean(f?.readable),
              reason: typeof f?.reason === 'string' ? f.reason : '',
              inside: Boolean(f?.inside),
              functions: Array.isArray(f?.functions)
                ? /** @type {any[]} */ (f.functions).map((/** @type {any} */ fn) => ({
                    name: typeof fn?.name === 'string' ? fn.name : '',
                    line: Number(fn?.line) || 1,
                  }))
                : [],
            }))
          : [],
      }))
    : []

  const includes = Array.isArray(obj.includes)
    ? /** @type {any[]} */ (obj.includes).map((/** @type {any} */ inc) => ({
        path: typeof inc?.path === 'string' ? inc.path.replaceAll('\\', '/') : '',
        exists: Boolean(inc?.exists),
        inside: Boolean(inc?.inside),
      }))
    : []

  const defines = Array.isArray(obj.defines)
    ? /** @type {any[]} */ (obj.defines).map((/** @type {any} */ d) => String(d || ''))
    : []

  const includeEdges = Array.isArray(obj.include_edges)
    ? /** @type {any[]} */ (obj.include_edges).map((/** @type {any} */ e) => ({
        from: typeof e?.from === 'string' ? e.from.replaceAll('\\', '/') : '',
        name: typeof e?.name === 'string' ? e.name.replaceAll('\\', '/') : '',
        to: typeof e?.to === 'string' ? e.to.replaceAll('\\', '/') : '',
        resolved: Boolean(e?.resolved),
      }))
    : []

  const truncated = {
    files: Boolean(obj.truncated?.files),
    includes: Boolean(obj.truncated?.includes),
    defines: Boolean(obj.truncated?.defines),
    include_edges: Boolean(obj.truncated?.include_edges),
    functions: Boolean(obj.truncated?.functions),
  }

  const limits = {
    files: Number(obj.limits?.files) || MAX_MAP_FILES,
    includes: Number(obj.limits?.includes) || MAX_MAP_INCLUDES,
    defines: Number(obj.limits?.defines) || MAX_MAP_DEFINES,
    include_edges: Number(obj.limits?.include_edges) || MAX_MAP_EDGES,
    functions: Number(obj.limits?.functions) || MAX_FUNCS_TOTAL,
  }

  let fileCount = 0
  let missing = 0
  let unreadable = 0
  let funcTotal = 0

  for (const group of groups) {
    fileCount += group.files.length
    for (const file of group.files) {
      if (!file.exists && file.inside) missing++
      if (file.exists && !file.readable) unreadable++
      funcTotal += file.functions.length
    }
  }

  const counts = {
    groups: groups.length,
    files: Number(obj.counts?.files ?? fileCount),
    missing: Number(obj.counts?.missing ?? missing),
    unreadable: Number(obj.counts?.unreadable ?? unreadable),
    includes: includes.length,
    defines: defines.length,
    include_edges: includeEdges.length,
    functions: Number(obj.counts?.functions ?? funcTotal),
  }

  return {
    project,
    target,
    groups,
    includes,
    defines,
    include_edges: includeEdges,
    truncated,
    limits,
    counts,
  }
}
