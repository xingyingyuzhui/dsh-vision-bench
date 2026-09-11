// @ts-check
import { realpathSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/**
 * Canonicalises a workspace path so two spellings of the same directory compare equal.
 *
 * Differences that must NOT break a session lookup:
 *  - trailing separator: `/a/b` vs `/a/b/`
 *  - relative vs absolute: `./proj` vs `/Users/x/proj`
 *  - symlinks: macOS `/tmp` is really `/private/tmp`, and iCloud Drive paths are
 *    symlinked too — a caller holding either spelling must still find its session
 *  - letter case: on the default case-insensitive APFS volume, `/Users/x/foo`
 *    and `/Users/x/Foo` are the same directory
 *
 * `realpathSync` handles all four at once: it resolves symlinks and returns the
 * path with the casing actually stored on disk. We deliberately do NOT lowercase
 * the result — that would wrongly merge genuinely distinct directories on a
 * case-sensitive volume. When the path does not exist yet we fall back to the
 * plain resolved form, because a path that cannot be stat'ed must never make an
 * otherwise valid comparison fail.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCwd(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''

  let out = resolvePath(raw)
  try {
    out = realpathSync(out)
  } catch {
    /* path does not exist (yet) — keep the resolved form */
  }

  // Drop a trailing separator, but never turn '/' into ''.
  while (out.length > 1 && (out.endsWith('/') || out.endsWith('\\'))) {
    out = out.slice(0, -1)
  }
  return out
}

/**
 * Compares two workspace paths after canonicalisation.
 *
 * Returns false when either side is empty: an absent cwd is a caller bug, and
 * silently treating it as "matches everything" is how scope checks get bypassed.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameCwd(left, right) {
  const a = normalizeCwd(left)
  const b = normalizeCwd(right)
  if (!a || !b) return false
  return a === b
}
