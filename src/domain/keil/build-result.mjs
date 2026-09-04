// @ts-check

export const UV4_TIMEOUT_SEC = 600
export const MAX_ERROR_LINES = 8
export const MAX_EXCERPT_CHARS = 8000

/** @type {Record<number, { status: 'ok' | 'error', desc: string }>} */
export const ERRORLEVEL_MAP = {
  0: { status: 'ok', desc: '无错误或警告' },
  1: { status: 'ok', desc: '有警告' },
  2: { status: 'error', desc: '有错误' },
  3: { status: 'error', desc: '致命错误' },
  11: { status: 'error', desc: '无法打开工程文件' },
}

/**
 * Normalizes build result object to ensure a stable contract.
 *
 * @param {any} raw
 * @returns {any}
 */
export function normalizeBuildResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      status: 'error',
      action: 'build',
      summary: '编译失败',
      error: { code: 'build_failed', message: '编译失败' },
    }
  }
  return raw
}
