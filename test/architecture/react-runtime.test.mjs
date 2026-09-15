// @ts-check
// P1-3：React 页面运行时自身的契约。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPageWindow,
  installReactPageRuntime,
  pageWindow,
  useReactPageRuntime,
} from '../helpers/react-runtime.mjs'

test('page profile 安装 DOM 全局且不注入 vendor', async () => {
  const { restore } = await installReactPageRuntime({ profile: 'page' })
  try {
    assert.ok(pageWindow)
    assert.equal(getPageWindow(), pageWindow)
    assert.equal(globalThis.document, pageWindow.document)
    assert.equal(typeof globalThis.requestAnimationFrame, 'function')
    assert.equal(globalThis.DvbVendor, undefined)
  } finally {
    restore()
  }
})

test('virtualized profile 注入 vendor，restore 后清掉', async () => {
  const { restore } = await installReactPageRuntime({ profile: 'virtualized' })
  try {
    assert.ok(globalThis.DvbVendor)
    assert.equal(typeof globalThis.DvbVendor.useVirtualizer, 'function')
    assert.equal(typeof globalThis.DvbVendor.uPlot, 'function')
  } finally {
    restore()
  }
  assert.equal(globalThis.DvbVendor, undefined)
})

test('failOnWarn 把意外 console.warn 变成抛错，并在 restore 时还原', async () => {
  const { restore } = await installReactPageRuntime({ profile: 'page', failOnWarn: true })
  try {
    assert.throws(() => console.warn('virtualizer boom'), /UnexpectedConsoleWarn|unexpected console.warn/)
  } finally {
    restore()
  }
  assert.doesNotThrow(() => console.warn('safe after restore'))
})

test('第二次 virtualized install 在 vendor 被清掉后仍能重新注入', async () => {
  const first = await installReactPageRuntime({ profile: 'virtualized' })
  first.restore()
  assert.equal(globalThis.DvbVendor, undefined)
  const second = await installReactPageRuntime({ profile: 'virtualized' })
  try {
    assert.ok(globalThis.DvbVendor)
  } finally {
    second.restore()
  }
})

test('useReactPageRuntime 已导出', () => {
  assert.equal(typeof useReactPageRuntime, 'function')
})
