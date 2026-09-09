import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TYPOGRAPHY_TOKENS,
  setGlobalFontScale,
  getGlobalFontScale,
  renderText,
  renderHeading,
} from '../src/ui/components/typography.mjs'
import { TYPOGRAPHY_CSS } from '../src/ui/styles/typography.mjs'
import { CSS } from '../bench-styles.mjs'
import { HMI_CSS } from '../src/ui/styles/hmi.mjs'
import { BASE_CSS } from '../src/ui/styles/base.mjs'

test('TYPOGRAPHY_TOKENS: 基础字号规范为 13px（完全对齐取消/保存胶囊按钮）', () => {
  assert.equal(TYPOGRAPHY_TOKENS.fontSize.base, '13px')
  assert.equal(TYPOGRAPHY_TOKENS.fontSize.sm, '12px')
  assert.equal(TYPOGRAPHY_TOKENS.fontSize.xs, '11px')
  assert.equal(TYPOGRAPHY_TOKENS.fontSize.md, '14px')
  assert.equal(TYPOGRAPHY_TOKENS.fontSize.lg, '16px')
  assert.equal(TYPOGRAPHY_TOKENS.fontSize.xl, '18px')
})

test('TYPOGRAPHY_CSS: 提供全局缩放因子 --dvb-font-scale 与动态 calc 计算', () => {
  const css = TYPOGRAPHY_CSS.join('\n')
  assert.match(css, /--dvb-font-scale:1;/)
  assert.match(css, /--dvb-font-size-base:calc\(var\(--dvb-font-scale, 1\) \* 13px\);/)
  assert.match(css, /--dvb-font-size-sm:calc\(var\(--dvb-font-scale, 1\) \* 12px\);/)
  assert.match(css, /--dvb-font-size-xs:calc\(var\(--dvb-font-scale, 1\) \* 11px\);/)
  assert.match(css, /--dvb-font-size-md:calc\(var\(--dvb-font-scale, 1\) \* 14px\);/)
  assert.match(css, /--dvb-font-family:/)
  assert.match(css, /--dvb-font-family-mono:/)
})

test('bench-styles.mjs: 统一聚合了 TYPOGRAPHY_CSS', () => {
  assert.match(CSS, /--dvb-font-size-base:/)
  assert.match(CSS, /--dvb-font-scale:/)
})

test('按钮与操作栏统一：dvb-btn-sm 高度提升至 28px，字号统一为 13px 变量', () => {
  const hmiCss = HMI_CSS.join('\n')
  const baseCss = BASE_CSS.join('\n')

  // dvb-btn-sm 在 hmi.mjs 中高度应为 28px，字号对齐 base 13px
  assert.match(hmiCss, /\.dvb-btn-sm\{height:28px;padding:0 12px;font-size:var\(--dvb-font-size-base,13px\)/)
  // dvb-btn-pill.dvb-btn-sm 高度同样为 28px，字号统一为 base 13px
  assert.match(baseCss, /\.dvb-btn-pill\.dvb-btn-sm\{height:28px;padding:0 14px;font-size:var\(--dvb-font-size-base,13px\)\}/)
})

test('按钮与 Tab 全量交互系统：hover 高亮与 active 按压反馈覆盖', () => {
  const baseCss = BASE_CSS.join('\n')
  const hmiCss = HMI_CSS.join('\n')

  // dvb-btn 默认 hover 与 active 反馈
  assert.match(baseCss, /\.dvb-btn:hover:not\(:disabled\)/)
  assert.match(baseCss, /\.dvb-btn:active:not\(:disabled\)\{transform:scale\(0\.97\)\}/)

  // 主要按钮 (dvb-btn-primary / is-on) 具有明确品牌蓝 hover 高亮
  assert.match(baseCss, /\.dvb-btn-primary:hover:not\(:disabled\)/)
  assert.match(baseCss, /--dsw-alias-brand-primary/)

  // 危险操作 hover 红底高亮
  assert.match(baseCss, /\.dvb-btn-danger-hover:hover\{[^}]*background:rgba\(229,57,53,\.08\)!important/)

  // Tab 具有 hover 高亮与 active 按压反馈
  assert.match(hmiCss, /\.dvb-tab:hover\{border-color:var\(--dsw-alias-brand-primary/)
  assert.match(hmiCss, /\.dvb-tab:active\{transform:scale\(0\.97\)\}/)
})

test('点位表与数据表格全量适配 13px 基础字号', () => {
  const hmiCss = HMI_CSS.join('\n')
  assert.match(hmiCss, /\.dvb-table\{width:100%;border-collapse:collapse;font-size:var\(--dvb-font-size-base,13px\)\}/)
  assert.match(hmiCss, /\.dvb-point-table \.dvb-input\{[^}]*font-size:var\(--dvb-font-size-base,13px\)/)
  assert.match(hmiCss, /\.dvb-cell-value\{font-size:var\(--dvb-font-size-base,13px\)/)
})

test('setGlobalFontScale / getGlobalFontScale: 动态调整全局缩放因子', () => {
  const fakeEl = {
    style: {
      setProperty(prop, val) {
        this[prop] = val
      },
    },
  }
  setGlobalFontScale(1.2, fakeEl)
  assert.equal(fakeEl.style['--dvb-font-scale'], '1.2')
})

test('renderText / renderHeading: 渲染标准化排版语义结构', () => {
  const mockEl = (tag, props, children) => ({ tag, props, children })

  const textNode = renderText(mockEl, '测试文本', { variant: 'base', weight: 'medium' })
  assert.equal(textNode.tag, 'span')
  assert.ok(textNode.props.className.includes('dvb-text-base'))
  assert.ok(textNode.props.className.includes('dvb-font-medium'))
  assert.equal(textNode.children, '测试文本')

  const headingNode = renderHeading(mockEl, '设备列表', { level: 2 })
  assert.equal(headingNode.tag, 'h2')
  assert.ok(headingNode.props.className.includes('dvb-text-lg'))
  assert.ok(headingNode.props.className.includes('dvb-font-semibold'))
})
