// @ts-check
/** Normalize a Windows/unix serial path for uniqueness checks. Pure string helper.
 * @param {unknown} port
 */
export function portKey(port) {
  return String(port || '')
    .replace(/^\\\\\.\\/, '')
    .trim()
    .toUpperCase()
}
