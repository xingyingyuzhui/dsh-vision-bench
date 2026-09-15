// @ts-check

/**
 * Builds a line offset index for fast 1-indexed (line, column) resolution from character offsets.
 * @param {string} source
 * @returns {(offset: number) => { line: number, column: number }}
 */
export function createOffsetToLocation(source) {
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1)
    }
  }

  return (offset) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (lineStarts[mid] <= offset) {
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    const lineIndex = high >= 0 ? high : 0
    const line = lineIndex + 1
    const column = offset - lineStarts[lineIndex] + 1
    return { line, column }
  }
}
