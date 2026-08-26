import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentRef, dispatchAgentRef, hasHarnessInput } from '../bench-shared.mjs'

// Task5/0.18.2: dispatchAgentRef(ref, bridge, options) is a pure command function.
// bridge = { currentDraft, setDraft, submit }; hook reads happen at component
// render top-level (readInputDraft), never inside dispatch.

const ref = buildAgentRef('point', { pointId: 'p1', connectionId: 'c1' }, { configVersion: 2 })

test('Task5: 已有中文输入不被覆盖 — dispatch appends after newline', () => {
  let draft = '用户已输入的中文草稿'
  const bridge = {
    currentDraft: draft,
    setDraft(t) { draft = t },
  }
  const r = dispatchAgentRef(ref, bridge)
  assert.equal(r.mode, 'input')
  assert.equal(r.status, '已加入输入框')
  assert.ok(draft.startsWith('用户已输入的中文草稿\n'), 'existing user draft must be kept, ref appended on a new line')
  assert.ok(draft.indexOf('"pointId": "p1"') > draft.indexOf('用户已输入的中文草稿'), 'serialized ref must follow the draft')
  // empty draft -> plain replace, no leading newline
  let empty = ''
  dispatchAgentRef(ref, { currentDraft: '', setDraft(t) { empty = t } })
  assert.ok(empty.startsWith('{'), 'empty draft is set directly')
  assert.equal(empty.startsWith('\n'), false)
})

test('Task5: 连续追加按序 — sequential dispatches stay ordered and never clobber', () => {
  let draft = ''
  const refs = [
    buildAgentRef('point', { pointId: 'p1', connectionId: 'c1' }, { configVersion: 2 }),
    buildAgentRef('frame', { frameId: 'f1', connectionId: 'c1', deviceId: 'd1' }, { configVersion: 2 }),
    buildAgentRef('alarm', { alarmId: 'a1', connectionId: 'c1' }, { configVersion: 2 }),
  ]
  const text = []
  for (const r of refs) {
    const res = dispatchAgentRef(r, { currentDraft: draft, setDraft(t) { draft = t } })
    assert.equal(res.mode, 'input')
    text.push(JSON.stringify(r))
  }
  const pos = (needle) => draft.indexOf(needle)
  assert.ok(pos('"pointId": "p1"') > 0)
  assert.ok(pos('"frameId": "f1"') > pos('"pointId": "p1"'), 'second append must come after first')
  assert.ok(pos('"alarmId": "a1"') > pos('"frameId": "f1"'), 'third append must come after second')
  assert.equal((draft.match(/"pointId": "p1"/g) || []).length, 1, 'no duplicate/overwrite of earlier refs')
})

test('Task5: 只有 opts.send 才调 submit；发送成功枚举 sent', () => {
  let submitted = 0
  const bridge = {
    currentDraft: '',
    setDraft() {},
    submit() { submitted += 1 },
  }
  const noSend = dispatchAgentRef(ref, bridge)
  assert.equal(noSend.mode, 'input')
  assert.equal(submitted, 0, 'submit must not run without opts.send')
  const sent = dispatchAgentRef(ref, bridge, { send: true })
  assert.equal(sent.mode, 'sent')
  assert.equal(sent.status, '已发送')
  assert.equal(submitted, 1)
})

test('Task5: 无写接口时剪贴板回退 mode copied；剪贴板不可用则 failed', async () => {
  const prevNav = globalThis.navigator
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText() { return Promise.resolve() } } }, configurable: true, writable: true })
    const r = await Promise.resolve(dispatchAgentRef(ref, { currentDraft: '', setDraft: null }))
    assert.equal(r.mode, 'copied', 'no writer -> clipboard fallback')
    assert.ok(r.status === '仅复制' || r.status === '已复制组件引用')
    assert.equal(r.fallback, true)
    // writer present but submit missing: input (not copied)
    const w = await Promise.resolve(dispatchAgentRef(ref, { currentDraft: '', setDraft() {} }))
    assert.equal(w.mode, 'input')
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: prevNav, configurable: true, writable: true })
  }
  // no clipboard at all (node default) -> failed
  const r2 = await Promise.resolve(dispatchAgentRef(ref, { currentDraft: '', setDraft: null }))
  assert.equal(r2.mode, 'failed')
  assert.ok(r2.status === '处理失败' || r2.status === '复制失败')
  assert.equal(r2.ok, false)
})

test('Task5: 不产生 Invalid Hook Call — dispatch 是纯命令函数，不调用任何 Hook', () => {
  let hookCalls = 0
  const poisoned = {
    currentDraft: '已有文本',
    setDraft() {},
    // a hook-shaped trap: dispatch must never touch it (hooks only run at component render top-level)
    useInput() { hookCalls += 1; throw new Error('Invalid hook call') },
  }
  const r = dispatchAgentRef(ref, poisoned)
  assert.equal(r.mode, 'input')
  assert.equal(hookCalls, 0, 'dispatchAgentRef must be pure: no hook reads inside the command')

  // legacy props-shaped objects are not accepted as bridges anymore: no inputActions magic
  let written = null
  const legacy = { inputActions: { setDraft(t) { written = t } }, useInput: () => { hookCalls += 1; throw new Error('Invalid hook call') } }
  dispatchAgentRef(ref, legacy)
  assert.equal(written, null, 'props.inputActions must not be reachable from inside dispatch')
  assert.equal(hookCalls, 0)
})

test('Task5: hasHarnessInput 仍只认写入者（reader-only 不算）', () => {
  assert.equal(hasHarnessInput({}), false)
  assert.equal(hasHarnessInput({ useInput: () => {} }), false, 'reader-only must not claim harness input')
  assert.equal(hasHarnessInput({ inputActions: { setDraft() {} } }), true)
  assert.equal(hasHarnessInput({ session: { inputActions: { setDraft() {} } } }), true)
})

test('Task5: buildAgentRef point 引用保持稳定 ID+configVersion+timeRange', () => {
  const r = buildAgentRef('point', { pointId: 'p1', connectionId: 'c1', deviceId: 'd1' }, { configVersion: 7 })
  assert.equal(r.pointId, 'p1')
  assert.equal(r.configVersion, 7)
  assert.ok(Number.isFinite(r.timeRange.start))
})