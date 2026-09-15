// @ts-check
// P1-1：测试工厂自身的契约。工厂是基础设施，坏掉的工厂会把「重复 setup」
// 换成「重复错误」，所以它必须比调用方更早被验证。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { connection, createBench, createTempDir, pointSeries } from '../helpers/workspace-factory.mjs'

/** Capture `t.after` callbacks so cleanup can be asserted deterministically. */
function spyContext() {
  /** @type {Array<() => any>} */
  const hooks = []
  return { hooks, t: { after: (fn) => hooks.push(fn) } }
}

test('工厂注册 t.after 回收，且回收是幂等的', async () => {
  const { hooks, t } = spyContext()
  const bench = await createBench(t, { prefix: 'dvb-factory-' })

  assert.equal(hooks.length, 1, 'one cleanup hook per bench')
  assert.ok(existsSync(bench.home), 'temp home exists while the test runs')
  assert.ok(existsSync(bench.cwd), 'project cwd exists while the test runs')

  await hooks[0]()
  assert.equal(existsSync(bench.home), false, 't.after reclaims the temp tree')
  await bench.cleanup()
  assert.equal(existsSync(bench.home), false, 'cleanup stays idempotent')
})

test('setup 抛错时仍然登记了回收', async () => {
  const { hooks, t } = spyContext()
  // 取值器在展开时才求值，正好用来让 setup 在 track() 之后失败。
  const boom = {
    get bad() {
      throw new Error('boom')
    },
  }
  await assert.rejects(() => createBench(t, { workspace: boom }), /boom/)
  assert.equal(hooks.length, 1, 'track() must run before anything that can throw')
  await hooks[0]()
})

test('createTempDir 无测试上下文时退化为进程退出兜底', async () => {
  const dir = await createTempDir(undefined, 'dvb-bare-')
  assert.ok(existsSync(dir))
  // 没有 t 时不该抛错，也不该立刻删除——退出钩子负责最终回收。
  assert.equal(existsSync(dir), true)
})

test('connection 为 rtu/tcp 生成可用的 conn 片段', () => {
  const rtu = connection('c1', 'rtu', 'COM3')
  assert.equal(rtu.role, 'client')
  assert.equal(rtu.enabled, true)
  assert.equal(rtu.conn.mode, 'rtu')
  assert.equal(rtu.conn.port, 'COM3')
  assert.equal(rtu.conn.host, '', 'rtu must not carry a tcp host')

  const tcp = connection('c2', 'tcp', '', { sim: true })
  assert.equal(tcp.conn.host, '127.0.0.1')
  assert.equal(tcp.conn.tcpPort, 502)
  assert.equal(tcp.conn.sim, true, 'overrides merge into conn')

  assert.equal(connection('c3').conn.mode, 'tcp', 'tcp is the default mode')
})

test('pointSeries 生成从 0 开始的连续保持寄存器', () => {
  const pts = pointSeries('保持', 3)
  assert.deepEqual(
    pts.map((p) => [p.name, p.function, p.address]),
    [
      ['保持0', 3, 0],
      ['保持1', 3, 1],
      ['保持2', 3, 2],
    ],
  )
  assert.equal(pointSeries('p', 2, { connectionId: 'c1' })[0].connectionId, 'c1')
})

test('单会话场景：session 投影出该会话的私有连接', async (t) => {
  const bench = await createBench(t, {
    sessions: { 'session-a': { connections: [connection('conn-a', 'tcp')] } },
  })
  assert.equal(bench.session('session-a').connections.length, 1)
  assert.equal(bench.session('session-a').connections[0].id, 'conn-a')
})

test('双会话场景：两个会话各自独立，互不可见', async (t) => {
  const bench = await createBench(t, {
    prefix: 'dvb-dual-',
    sessions: {
      'session-a': { connections: [connection('conn-a', 'tcp')] },
      'session-b': { connections: [connection('conn-b', 'tcp')] },
    },
  })
  assert.equal(bench.session('session-a').connections[0].id, 'conn-a')
  assert.equal(bench.session('session-b').connections[0].id, 'conn-b')

  // 另一会话的私有层不能泄漏进本会话的投影。
  const idsA = bench.session('session-a').connections.map((c) => c.id)
  assert.equal(idsA.includes('conn-b'), false)
})

test('多连接场景：shared 拓扑对所有会话可见', async (t) => {
  const bench = await createBench(t, {
    prefix: 'dvb-multi-',
    shared: {
      connections: [connection('c1', 'rtu', 'COM3'), connection('c2', 'rtu', 'COM5'), connection('c3', 'tcp')],
    },
  })
  const modbus = bench.modbus()
  assert.deepEqual(
    modbus.connections.map((c) => c.id),
    ['c1', 'c2', 'c3'],
  )
  assert.deepEqual(
    modbus.connections.map((c) => c.conn.mode),
    ['rtu', 'rtu', 'tcp'],
  )
  assert.equal(modbus.connections[1].conn.port, 'COM5', 'serial device path survives')
  assert.equal(modbus.connections[2].conn.host, '127.0.0.1', 'tcp host survives')
})

test('store 会为任何 modbus patch 补齐默认连接与设备', async (t) => {
  // 使用工厂时必须知道这条生产语义：即使只写一个空 modbus，
  // 磁盘上也会出现一条连接和一台设备，所以「空工作区」并不存在。
  const bench = await createBench(t, { prefix: 'dvb-synth-', shared: {} })
  const modbus = bench.modbus()
  assert.equal(modbus.connections.length, 1, '未声明连接时 store 合成默认连接')
  assert.equal(modbus.devices.length, 1, '并为其合成默认设备')
  assert.equal(modbus.points.length, 0, '点表不会被凭空合成')
})

test('配置漂移场景：drift 改写单个会话的端点而不动其他会话', async (t) => {
  const bench = await createBench(t, {
    prefix: 'dvb-drift-',
    sessions: {
      'session-a': { connections: [connection('conn-a', 'tcp')], activeConnectionId: 'conn-a' },
      'session-b': { connections: [connection('conn-b', 'tcp')], activeConnectionId: 'conn-b' },
    },
  })

  const before = bench.session('session-a').connections[0].conn.host
  const drifted = (bench.session('session-a').connections || []).map((c) => ({
    ...c,
    conn: { ...(c.conn || {}), host: '10.9.9.9' },
  }))
  const res = await bench.drift('session-a', { connections: drifted })
  assert.equal(res.ok, true, res.error)

  assert.equal(bench.session('session-a').connections[0].conn.host, '10.9.9.9')
  assert.notEqual(before, '10.9.9.9')
  assert.equal(bench.session('session-b').connections[0].conn.host, '127.0.0.1', 'session-b untouched')
})

test('modbus 逃生口覆盖 shared 的默认值', async (t) => {
  const bench = await createBench(t, {
    prefix: 'dvb-escape-',
    shared: { connections: [connection('c1', 'rtu', 'COM3')] },
    modbus: { version: 3, configVersion: 7, share: { enabled: false } },
  })
  const modbus = bench.modbus()
  assert.equal(modbus.configVersion, 7)
  assert.equal(modbus.share.enabled, false)
  assert.equal(modbus.connections.length, 1, 'escape hatch merges, does not replace')
})

test('project: null 时 cwd 就是 home，不额外建子目录', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-flat-', project: null })
  assert.equal(bench.cwd, bench.home)
  assert.ok(existsSync(bench.home))
})

test('save/load/at/write/read/exists 围绕同一个 home+cwd 工作', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-io-' })
  bench.save({ keil: { target: 'Debug' } })
  assert.equal(bench.load().keil.target, 'Debug')

  await bench.write('notes.txt', 'hello')
  assert.equal(await bench.read('notes.txt'), 'hello')
  assert.equal(bench.exists('notes.txt'), true)
  assert.equal(bench.at('notes.txt'), `${bench.cwd}/notes.txt`)
  assert.equal(bench.exists('missing.txt'), false)
})
