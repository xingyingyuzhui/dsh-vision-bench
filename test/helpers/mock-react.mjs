// @ts-check
/** Minimal React mock for debug hook unit tests (no DOM). */
export function createMockReact() {
  const stateMap = new Map()
  let stateIndex = 0
  const refMap = new Map()
  let refIndex = 0

  return {
    reset() {
      stateIndex = 0
      refIndex = 0
    },
    useState(init) {
      const idx = stateIndex++
      if (!stateMap.has(idx)) {
        stateMap.set(idx, typeof init === 'function' ? init() : init)
      }
      const val = stateMap.get(idx)
      const setVal = (next) => {
        const newVal = typeof next === 'function' ? next(stateMap.get(idx)) : next
        stateMap.set(idx, newVal)
      }
      return [val, setVal]
    },
    useEffect() {},
    useCallback(fn) {
      return fn
    },
    useMemo(fn) {
      return fn()
    },
    useRef(init) {
      const idx = refIndex++
      if (!refMap.has(idx)) {
        refMap.set(idx, { current: init })
      }
      return refMap.get(idx)
    },
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat().filter(Boolean) }
    },
  }
}
