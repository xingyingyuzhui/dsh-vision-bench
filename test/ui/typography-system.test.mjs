import assert from 'node:assert/strict'
import test from 'node:test'
import { TYPOGRAPHY_CSS } from '../../src/ui/styles/typography.mjs'
import { CSS } from '../../bench-styles.mjs'
import { HMI_CSS } from '../../src/ui/styles/hmi.mjs'
import { BASE_CSS } from '../../src/ui/styles/base.mjs'

test('排版 token 由 styles/typography.mjs 定义并被 bench-styles 聚合', () => {
  const css = TYPOGRAPHY_CSS.join('\n')
  assert.match(css, /--dvb-font-scale:1;/)
  assert.match(css, /--dvb-font-size-base:calc\(var\(--dvb-font-scale, 1\) \* 13px\)/)
  assert.match(css, /--dvb-font-size-sm:calc\(var\(--dvb-font-scale, 1\) \* 12px\)/)
  assert.match(css, /--dvb-space-2:8px/)
  assert.match(CSS, /--dvb-font-size-base:/)
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

  // Tab 具有 hover 高亮与 active 按压反馈（浅灰边，不用 brand-primary 近黑色）
  assert.match(hmiCss, /\.dvb-tab:hover:not\(\.is-on\):not\(\.is-warn\)\{background:var\(--dsw-alias-bg-module-platform,#f1f3f5\);border-color:var\(--dsw-alias-border-l2,#d8dadc\)\}/)
  assert.match(hmiCss, /\.dvb-tab:active\{transform:scale\(0\.97\)\}/)

  // 选中不加粗：字重固定，避免切换二级页签时整条宽度跳动
  assert.match(hmiCss, /\.dvb-tab\{[^}]*font-weight:500/)
  assert.doesNotMatch(hmiCss, /\.dvb-tab\.is-on\{[^}]*font-weight/)
})

test('点位表与数据表格全量适配 13px 基础字号', () => {
  const hmiCss = HMI_CSS.join('\n')
  assert.match(hmiCss, /\.dvb-table\{width:100%;border-collapse:collapse;font-size:var\(--dvb-font-size-base,13px\)\}/)
  assert.match(hmiCss, /\.dvb-point-table \.dvb-input\{[^}]*font-size:var\(--dvb-font-size-base,13px\)/)
  assert.match(hmiCss, /\.dvb-cell-value\{font-size:var\(--dvb-font-size-base,13px\)/)
})
