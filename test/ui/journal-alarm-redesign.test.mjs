import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAlarmTimelineNodes,
  formatAlarmAck,
  formatAlarmCondition,
  formatAlarmSeverity,
  formatAlarmSubtitle,
  formatAlarmTitle,
  formatAlarmTriggerCondition,
} from '../../src/ui/monitor/alarms/alarm-format.mjs'
import {
  formatFullDateTime,
  formatJournalAction,
  formatJournalResult,
  formatJournalSource,
  formatJournalTarget,
  formatTimeOnly,
  isJournalSuccess,
  serializeJournalItem,
} from '../../src/ui/monitor/journal/journal-format.mjs'

test('journal formatting helpers properly handle various events and sources', () => {
  assert.equal(formatTimeOnly(1789108225000).length, 8)
  assert.ok(formatFullDateTime(1789108225000).includes(':'))

  // Source formatting
  const userSrc = formatJournalSource('user')
  assert.equal(userSrc.key, 'user')
  assert.equal(userSrc.label, '用户')
  assert.equal(userSrc.icon, '👤')

  const agentSrc = formatJournalSource('agent')
  assert.equal(agentSrc.key, 'agent')
  assert.equal(agentSrc.label, 'Agent')
  assert.equal(agentSrc.icon, '🤖')

  const sysSrc = formatJournalSource('system')
  assert.equal(sysSrc.key, 'system')
  assert.equal(sysSrc.label, '系统')
  assert.equal(sysSrc.icon, '⚙️')

  // Result formatting
  assert.equal(isJournalSuccess({ ok: true }), true)
  assert.equal(isJournalSuccess({ ok: false }), false)
  assert.equal(isJournalSuccess({ summary: '编译失败' }), false)
  assert.equal(isJournalSuccess({ summary: '点位越限告警' }), true)

  const resOk = formatJournalResult({ ok: true })
  assert.equal(resOk.ok, true)
  assert.equal(resOk.label, '成功')
  assert.equal(resOk.icon, '✔')

  const resFail = formatJournalResult({ ok: false })
  assert.equal(resFail.ok, false)
  assert.equal(resFail.label, '失败')
  assert.equal(resFail.icon, '✖')

  // Action and target formatting
  const item1 = {
    id: 'op_1',
    kind: 'write',
    deviceId: 'D1',
    pointId: '40001',
    pointName: '反应釜温度',
    summary: '写入点位 D1:40001 (50.0)',
  }
  assert.equal(formatJournalAction(item1), '写入点位')
  assert.equal(formatJournalTarget(item1), 'D1:40001 (反应釜温度)')

  const serialized = serializeJournalItem(item1)
  assert.ok(serialized.includes('op_1'))
  assert.ok(serialized.includes('写入点位'))
})

test('alarm formatting helpers handle process and comm alarms', () => {
  const commAlarm = {
    id: 'comm:c1',
    group: 'comm',
    condition: 'active',
    acknowledged: false,
    severity: 'critical',
    firstAt: 1789108225000,
  }
  const conn1 = { id: 'c1', name: 'COM1' }
  assert.equal(formatAlarmTitle(commAlarm, null, conn1, null), 'COM1通讯中断')
  assert.equal(formatAlarmSubtitle(commAlarm, null, conn1, null), '通信 · COM1')

  const procAlarm = {
    id: 'p1',
    group: 'process',
    condition: 'active',
    acknowledged: false,
    severity: 'high',
    kind: 'max',
    value: 85.4,
    threshold: 80.0,
    firstAt: 1789108225000,
  }
  const dev1 = { id: 'd1', name: '设备A' }
  const pt1 = { id: 'p1', name: '温度', unit: '℃' }
  assert.equal(formatAlarmTitle(procAlarm, pt1, null, dev1), '设备A温度过高')
  assert.equal(formatAlarmSubtitle(procAlarm, pt1, null, dev1), '过程 · 设备A')

  // Severity
  const sevCrit = formatAlarmSeverity('critical')
  assert.equal(sevCrit.key, 'critical')
  assert.equal(sevCrit.label, '严重')
  assert.equal(sevCrit.icon, '!')

  const sevWarn = formatAlarmSeverity('medium')
  assert.equal(sevWarn.key, 'warn')
  assert.equal(sevWarn.label, '警告')
  assert.equal(sevWarn.icon, '⚠')

  // Condition & Ack
  const condAct = formatAlarmCondition(procAlarm)
  assert.equal(condAct.active, true)
  assert.equal(condAct.label, '激活')

  const ackUn = formatAlarmAck(procAlarm)
  assert.equal(ackUn.acked, false)
  assert.equal(ackUn.label, '未确认')

  // Trigger condition
  const condStr = formatAlarmTriggerCondition(procAlarm, pt1)
  assert.ok(condStr.includes('> 80'))
  assert.ok(condStr.includes('3s'))

  // Timeline nodes
  const nodes = buildAlarmTimelineNodes(procAlarm)
  assert.ok(nodes.length >= 2)
  assert.equal(nodes[0].title, '告警触发')
  assert.equal(nodes[0].tag, '待确认')
})

test('LogPage and AlarmPage mount and render split layout with toolbar and detail card', async () => {
  const { createLogPage } = await import('../../src/ui/monitor/journal/journal-page.mjs')
  const { createAlarmPage } = await import('../../src/ui/monitor/alarms/alarm-page.mjs')

  const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const ReactStub = {
    createElement: el,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
  }
  const post = async () => ({ ok: true })

  const LogPage = createLogPage(ReactStub, (k) => k, post, {})
  const logTree = LogPage({ tab: {}, scope: { cwd: '/test' } })
  assert.ok(logTree, 'LogPage renders')
  assert.equal(logTree.type, 'div')
  assert.ok(logTree.props.className.includes('dvb-journal-page'))

  const AlarmPage = createAlarmPage(ReactStub, (k) => k, post, {})
  const alarmTree = AlarmPage({ tab: {}, scope: { cwd: '/test' } })
  assert.ok(alarmTree, 'AlarmPage renders')
  assert.equal(alarmTree.type, 'div')
  assert.ok(alarmTree.props.className.includes('dvb-alarm-page'))
})

test('JournalFilterToolbar and AlarmFilterToolbar render labeled filter items and search box', async () => {
  const { createJournalFilterToolbar } = await import('../../src/ui/monitor/journal/journal-filter-toolbar.mjs')
  const { createAlarmFilterToolbar } = await import('../../src/ui/monitor/alarms/alarm-filter-toolbar.mjs')

  const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const ReactStub = {
    createElement: el,
    useState: (init) => [init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
  }

  // Journal toolbar
  const JournalToolbar = createJournalFilterToolbar(ReactStub, (k) => k)
  const jTree = JournalToolbar({})
  assert.equal(jTree.type, 'div')
  assert.ok(jTree.props.className.includes('dvb-filter-toolbar'))
  assert.ok(jTree.props.className.includes('dvb-journal-toolbar'))
  const jItems = jTree.children.filter((c) => c?.props?.className?.includes('dvb-filter-item'))
  assert.equal(jItems.length, 3, 'Should have 3 filter items (来源, 结果, 时间)')
  const jLabels = jItems.map((item) => item.children.find((c) => c?.props?.className?.includes('dvb-filter-label'))?.children[0])
  assert.deepEqual(jLabels, ['来源', '结果', '时间'])
  assert.ok(jTree.children.some((c) => c?.props?.className?.includes('dvb-search-box')))
  assert.ok(jTree.children.some((c) => c?.props?.className?.includes('dvb-btn-reset')))

  // Alarm toolbar
  const AlarmToolbar = createAlarmFilterToolbar(ReactStub, (k) => k)
  const aTree = AlarmToolbar({})
  assert.equal(aTree.type, 'div')
  assert.ok(aTree.props.className.includes('dvb-filter-toolbar'))
  assert.ok(aTree.props.className.includes('dvb-alarm-toolbar'))
  const aItems = aTree.children.filter((c) => c?.props?.className?.includes('dvb-filter-item'))
  assert.equal(aItems.length, 3, 'Should have 3 filter items (类型, 级别, 时间)')
  const aLabels = aItems.map((item) => item.children.find((c) => c?.props?.className?.includes('dvb-filter-label'))?.children[0])
  assert.deepEqual(aLabels, ['类型', '级别', '时间'])
  assert.ok(aTree.children.some((c) => c?.props?.className?.includes('dvb-search-box')))
  assert.ok(aTree.children.some((c) => c?.props?.className?.includes('dvb-btn-reset')))
})

