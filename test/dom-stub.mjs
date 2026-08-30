// Minimal browser DOM globals for tests that eval the generated client bundle.
// The bundle now legitimately embeds browser-only vendor libs (uPlot /
// virtual-core) that read `document`/`window` at init, mirroring the real DSH
// web loader where these always exist.
export function installDomStub() {
  const had = {
    window: 'window' in globalThis,
    document: 'document' in globalThis,
    navigator: 'navigator' in globalThis,
    ResizeObserver: 'ResizeObserver' in globalThis,
  }
  const stubs = {
    window: {
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }),
      devicePixelRatio: 1,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
      cancelAnimationFrame: clearTimeout,
    },
    document: {
      createElement: (tag) => ({
        setAttribute() {},
        appendChild() {},
        remove() {},
        style: {},
        classList: { add() {}, remove() {}, contains: () => false },
        innerText: '',
        textContent: '',
        getBoundingClientRect: () => ({ width: 300, height: 190, top: 0, left: 0, right: 300, bottom: 190 }),
        offsetHeight: 300,
        offsetWidth: 300,
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 300,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
      }),
      createElementNS: (ns, tag) => stubs.document.createElement(tag || 'div'),
      head: {
        appendChild() {},
        removeChild() {},
        addEventListener() {},
        dispatchEvent: () => true,
        insertBefore() {},
        querySelector: () => null,
      },
      body: {
        setAttribute() {},
        appendChild() {},
        removeChild() {},
        dispatchEvent: () => true,
        classList: { add() {}, remove() {}, contains: () => false },
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: {
        style: {},
        getAttribute: () => null,
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
        classList: { add() {}, remove() {}, contains: () => false },
      },
      getElementById: () => null,
    },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node' },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    // uPlot's minified code reads some bare browser globals directly
    devicePixelRatio: 1,
    screen: { width: 1920, height: 1080 },
    getComputedStyle: () => ({ getPropertyValue: () => '', setProperty() {}, removeProperty() {} }),
    customElements: { define() {}, get: () => undefined },
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  }
  for (const k of Object.keys(stubs)) {
    if (!had[k]) globalThis[k] = stubs[k]
  }
  return function restoreDomStub() {
    for (const k of Object.keys(stubs)) {
      if (!had[k]) delete globalThis[k]
    }
  }
}
