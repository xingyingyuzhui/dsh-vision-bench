import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeModbus } from '../bench-devices.mjs'
import {
  SHARE_REVOKE_CONFIRM_REQUIRED,
  applyShareFlags,
  claimLegacyPrivate,
  emptySessionConfig,
  emptyShareFlags,
  ensureScopeFields,
  foldModbusFromSession,
  hasTopology,
  normalizeShareFlags,
  projectModbusForSession,
  topologyFingerprint,
} from '../src/application/modbus/config-scope-service.mjs'

const A = 'session-a'
const B = 'session-b'

const legacyFlat = () =>
  normalizeModbus({
    version: 3,
    configVersion: 7,
    connections: [
      { id: 'c1', name: 'PLC', role: 'client', conn: { mode: 'tcp', host: '10.0.0.5', tcpPort: 502 } },
      { id: 'c2', name: 'RTU', role: 'client', conn: { mode: 'rtu', port: '/dev/ttyUSB0' } },
    ],
    devices: [
      { id: 'd1', connectionId: 'c1', name: 'inverter', unitId: 1 },
      { id: 'd2', connectionId: 'c2', name: 'meter', unitId: 5 },
    ],
    points: [
      { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'speed', area: 'holdingRegister', address: 10 },
      { id: 'p2', connectionId: 'c2', deviceId: 'd2', name: 'volt', area: 'inputRegister', address: 3 },
    ],
    values: [
      { pointId: 'p1', value: 12, at: 1000 },
      { pointId: 'p2', value: 220, at: 1000 },
    ],
    visualization: {
      schemaVersion: 2,
      components: [{ id: 'v1', type: 'value', name: 'Speed', pointIds: ['p1'] }],
    },
    activeConnectionId: 'c2',
    activeDeviceId: 'd2',
  })

const ids = (list) => (list || []).map((x) => x.id)
const connIds = (m) => ids(m.connections)
const pointIds = (m) => ids(m.points)
const vizIds = (m) => ids(m.visualization && m.visualization.components)

test('share flag helpers: defaults off, strict boolean coercion', () => {
  assert.deepEqual(emptyShareFlags(), { enabled: false, connections: false, points: false, visualization: false })
  assert.deepEqual(normalizeShareFlags({ enabled: 'yes', connections: true, points: 1, visualization: null }), {
    enabled: false,
    connections: true,
    points: false,
    visualization: false,
  })
  assert.deepEqual(emptySessionConfig(), {
    connections: [],
    devices: [],
    points: [],
    visualization: null,
    activeConnectionId: '',
    activeDeviceId: '',
  })
})

test('normalizeModbus preserves share / sessionConfigs / privateClaimSessionId and layered values', () => {
  const layered = normalizeModbus({
    version: 3,
    share: { enabled: true, points: true },
    privateClaimSessionId: A,
    sessionConfigs: {
      [A]: { points: [{ id: 'px', connectionId: 'c1', deviceId: 'd1', address: 1 }] },
      '': { points: [] },
    },
    values: [{ pointId: 'px', value: 1, at: 5 }],
  })
  assert.deepEqual(layered.share, { enabled: true, connections: false, points: true, visualization: false })
  assert.equal(layered.privateClaimSessionId, A)
  assert.deepEqual(Object.keys(layered.sessionConfigs), [A])
  assert.equal(layered.sessionConfigs[A].points[0].id, 'px')
  // value for a private-layer point survives normalization even though top-level has no points
  assert.equal(layered.values.length, 1)
  assert.equal(layered.values[0].pointId, 'px')
  // fields are enumerable so they persist through JSON round-trip
  const again = normalizeModbus(JSON.parse(JSON.stringify(layered)))
  assert.equal(again.privateClaimSessionId, A)
  assert.equal(again.sessionConfigs[A].points.length, 1)
})

test('topologyFingerprint / hasTopology treat synthesized defaults as empty', () => {
  assert.equal(hasTopology(normalizeModbus({ version: 3 })), false)
  assert.equal(hasTopology({}), false)
  assert.equal(hasTopology(legacyFlat()), true)
  assert.equal(topologyFingerprint(legacyFlat()), topologyFingerprint(legacyFlat()))
  assert.notEqual(topologyFingerprint(legacyFlat()), topologyFingerprint({}))
  // a configured but point-less connection still counts as topology
  assert.equal(hasTopology({ connections: [{ id: 'c1', conn: { port: '/dev/ttyUSB0' } }] }), true)
})

test('ensureScopeFields adds normalized scope fields without mutating input', () => {
  const src = { connections: [] }
  const out = ensureScopeFields(src)
  assert.equal('share' in src, false)
  assert.deepEqual(out.share, emptyShareFlags())
  assert.deepEqual(out.sessionConfigs, {})
  assert.equal(out.privateClaimSessionId, '')
})

test('1. claimLegacyPrivate moves topology to first session; second claim does not steal', () => {
  const first = claimLegacyPrivate(legacyFlat(), A)
  assert.equal(first.claimed, true)
  assert.equal(first.modbus.privateClaimSessionId, A)
  assert.deepEqual(first.modbus.share, emptyShareFlags())
  // top-level topology cleared back to synthesized defaults
  assert.equal(hasTopology(first.modbus), false)
  assert.equal(first.modbus.points.length, 0)
  // private slice holds everything, including active ids
  const priv = first.modbus.sessionConfigs[A]
  assert.deepEqual(ids(priv.connections), ['c1', 'c2'])
  assert.deepEqual(ids(priv.devices), ['d1', 'd2'])
  assert.deepEqual(ids(priv.points), ['p1', 'p2'])
  assert.equal(priv.activeConnectionId, 'c2')
  assert.equal(priv.activeDeviceId, 'd2')
  assert.deepEqual(ids(priv.visualization.components), ['v1'])
  // runtime stays shared at top-level and is not dropped
  assert.equal(first.modbus.configVersion, 7)
  assert.deepEqual(first.modbus.values.map((v) => v.pointId).sort(), ['p1', 'p2'])

  const second = claimLegacyPrivate(first.modbus, B)
  assert.equal(second.claimed, false)
  assert.equal(second.modbus.privateClaimSessionId, A)
  assert.deepEqual(Object.keys(second.modbus.sessionConfigs), [A])

  // empty legacy workspace: nothing to claim, claim marker stays empty
  const empty = claimLegacyPrivate(normalizeModbus({ version: 3 }), A)
  assert.equal(empty.claimed, false)
  assert.equal(empty.modbus.privateClaimSessionId, '')
  // missing sessionId never claims
  assert.equal(claimLegacyPrivate(legacyFlat(), '').claimed, false)
})

test('2. project: default private — session A sees its private, B sees empty defaults', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  const viewA = projectModbusForSession(modbus, A)
  assert.deepEqual(connIds(viewA), ['c1', 'c2'])
  assert.deepEqual(pointIds(viewA), ['p1', 'p2'])
  assert.deepEqual(vizIds(viewA), ['v1'])
  assert.equal(viewA.activeConnectionId, 'c2')
  assert.equal(viewA.activeDeviceId, 'd2')
  assert.equal(viewA.configVersion, 7)
  // round-trip metadata carried on the projection
  assert.equal(viewA.privateClaimSessionId, A)
  assert.deepEqual(Object.keys(viewA.sessionConfigs), [A])

  const viewB = projectModbusForSession(modbus, B)
  assert.equal(pointIds(viewB).length, 0)
  assert.equal(vizIds(viewB).length, 0)
  assert.equal(
    viewB.connections.some((c) => c.conn.host === '10.0.0.5'),
    false,
  )
  assert.equal(hasTopology(viewB), false)
})

test('3. applyShareFlags enable connections without confirm; B sees A published connections only', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  const res = applyShareFlags(modbus, A, { enabled: true, connections: true })
  assert.equal(res.ok, true)
  assert.deepEqual(res.published, ['connections'])
  assert.deepEqual(res.revoked, [])
  assert.deepEqual(res.modbus.share, { enabled: true, connections: true, points: false, visualization: false })
  // shared slice now holds connections + devices at top-level
  assert.deepEqual(connIds(res.modbus), ['c1', 'c2'])
  assert.deepEqual(ids(res.modbus.devices), ['d1', 'd2'])
  assert.equal(res.modbus.points.length, 0)

  const viewB = projectModbusForSession(res.modbus, B)
  assert.deepEqual(connIds(viewB), ['c1', 'c2'])
  assert.deepEqual(ids(viewB.devices), ['d1', 'd2'])
  assert.equal(viewB.activeConnectionId, 'c2')
  // points / visualization remain A-private
  assert.equal(pointIds(viewB).length, 0)
  assert.equal(vizIds(viewB).length, 0)
  const viewA = projectModbusForSession(res.modbus, A)
  assert.deepEqual(pointIds(viewA), ['p1', 'p2'])
  assert.deepEqual(vizIds(viewA), ['v1'])
})

test('4. applyShareFlags disable requires confirm; confirmed revoke returns slice to revoker', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  const shared = applyShareFlags(modbus, A, { enabled: true, connections: true }).modbus
  // B edits the shared slice (live shared editing) — add a device via fold
  const viewB = projectModbusForSession(shared, B)
  viewB.devices = [...viewB.devices, { id: 'd3', connectionId: 'c1', name: 'from-b', unitId: 9 }]
  const sharedByB = foldModbusFromSession(shared, viewB, B)
  assert.deepEqual(ids(sharedByB.devices), ['d1', 'd2', 'd3'])
  assert.deepEqual(ids(projectModbusForSession(sharedByB, A).devices), ['d1', 'd2', 'd3'])

  // unchecking the category without confirm → needsConfirm, store untouched
  const denied = applyShareFlags(sharedByB, A, { enabled: true, connections: false })
  assert.equal(denied.ok, false)
  assert.equal(denied.errorCode, SHARE_REVOKE_CONFIRM_REQUIRED)
  assert.equal(denied.needsConfirm, true)
  assert.deepEqual(denied.revoked, ['connections'])
  // master off without confirm is also denied
  assert.equal(applyShareFlags(sharedByB, A, { enabled: false, connections: true }).needsConfirm, true)

  // confirmed master off → revoke back into A's private layer
  const revoked = applyShareFlags(sharedByB, A, { enabled: false, connections: true }, { confirmed: true })
  assert.equal(revoked.ok, true)
  assert.deepEqual(revoked.revoked, ['connections'])
  assert.equal(revoked.modbus.share.enabled, false)
  assert.equal(hasTopology(revoked.modbus), false)
  const afterA = projectModbusForSession(revoked.modbus, A)
  assert.deepEqual(connIds(afterA), ['c1', 'c2'])
  assert.deepEqual(ids(afterA.devices), ['d1', 'd2', 'd3'])
  const afterB = projectModbusForSession(revoked.modbus, B)
  assert.equal(
    afterB.connections.some((c) => c.conn.host === '10.0.0.5'),
    false,
  )
  assert.equal(
    afterB.devices.some((d) => d.id === 'd3'),
    false,
  )

  // toggling flags with nothing effectively revoked needs no confirm (master on, no categories)
  const noop = applyShareFlags(revoked.modbus, A, { enabled: true })
  assert.equal(noop.ok, true)
  assert.deepEqual(noop.revoked, [])
  const offAgain = applyShareFlags(noop.modbus, A, { enabled: false })
  assert.equal(offAgain.ok, true)
})

test('5. points / visualization share independently of connections', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  const pointsOnly = applyShareFlags(modbus, A, { enabled: true, points: true }).modbus
  const viewB = projectModbusForSession(pointsOnly, B)
  assert.deepEqual(pointIds(viewB), ['p1', 'p2'])
  assert.equal(
    viewB.connections.some((c) => c.conn.host === '10.0.0.5'),
    false,
  )
  assert.equal(vizIds(viewB).length, 0)

  const vizToo = applyShareFlags(pointsOnly, A, { enabled: true, points: true, visualization: true }).modbus
  assert.deepEqual(vizIds(projectModbusForSession(vizToo, B)), ['v1'])
  assert.equal(
    projectModbusForSession(vizToo, B).connections.some((c) => c.conn.host === '10.0.0.5'),
    false,
  )

  // revoke only visualization; points stay shared
  const vizBack = applyShareFlags(vizToo, A, { enabled: true, points: true }, { confirmed: true })
  assert.equal(vizBack.ok, true)
  assert.deepEqual(vizBack.revoked, ['visualization'])
  assert.deepEqual(pointIds(projectModbusForSession(vizBack.modbus, B)), ['p1', 'p2'])
  assert.equal(vizIds(projectModbusForSession(vizBack.modbus, B)).length, 0)
  assert.deepEqual(vizIds(projectModbusForSession(vizBack.modbus, A)), ['v1'])
})

test('6. foldModbusFromSession writes to private layer when unshared', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  const viewB = projectModbusForSession(modbus, B)
  viewB.points = [{ id: 'pb', connectionId: viewB.connections[0].id, deviceId: viewB.devices[0].id, address: 40 }]
  viewB.configVersion = 8
  viewB.values = [{ pointId: 'pb', value: 3, at: 2000 }]
  const folded = foldModbusFromSession(modbus, viewB, B)
  // shared slice untouched (still synthesized defaults)
  assert.equal(hasTopology(folded), false)
  assert.equal(folded.points.length, 0)
  // B private has the new point; A private untouched
  assert.deepEqual(ids(folded.sessionConfigs[B].points), ['pb'])
  assert.deepEqual(ids(folded.sessionConfigs[A].points), ['p1', 'p2'])
  assert.deepEqual(pointIds(projectModbusForSession(folded, B)), ['pb'])
  assert.deepEqual(pointIds(projectModbusForSession(folded, A)), ['p1', 'p2'])
  // runtime folded at top-level: configVersion from projection, values merged across layers
  assert.equal(folded.configVersion, 8)
  assert.deepEqual(folded.values.map((v) => v.pointId).sort(), ['p1', 'p2', 'pb'])
  assert.equal(folded.privateClaimSessionId, A)
})

test('7. fold writes to shared when category shared; other session private preserved', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  // B has its own private points first
  const viewB0 = projectModbusForSession(modbus, B)
  viewB0.points = [{ id: 'pb', connectionId: 'c1', deviceId: 'd1', address: 40 }]
  const withB = foldModbusFromSession(modbus, viewB0, B)

  const shared = applyShareFlags(withB, A, { enabled: true, connections: true, points: true }).modbus
  const viewA = projectModbusForSession(shared, A)
  viewA.points = [...viewA.points, { id: 'p3', connectionId: 'c1', deviceId: 'd1', address: 99 }]
  viewA.connections = viewA.connections.map((c) => (c.id === 'c1' ? { ...c, name: 'PLC-renamed' } : c))
  const folded = foldModbusFromSession(shared, viewA, A)
  // landed in shared top-level
  assert.deepEqual(pointIds(folded), ['p1', 'p2', 'p3'])
  assert.equal(folded.connections.find((c) => c.id === 'c1').name, 'PLC-renamed')
  // B sees it live; B's private points are preserved for later revoke
  assert.deepEqual(pointIds(projectModbusForSession(folded, B)), ['p1', 'p2', 'p3'])
  assert.deepEqual(ids(folded.sessionConfigs[B].points), ['pb'])
  // A's private points/connections were not duplicated into private (category is shared)
  assert.deepEqual(ids(folded.sessionConfigs[A].points), ['p1', 'p2'])
  // visualization stayed A-private
  assert.deepEqual(vizIds(projectModbusForSession(folded, B)), [])
  assert.deepEqual(vizIds(projectModbusForSession(folded, A)), ['v1'])

  // revoking points afterwards: A gets the shared points, B falls back to its private pb
  const back = applyShareFlags(folded, A, { enabled: true, connections: true }, { confirmed: true })
  assert.deepEqual(pointIds(projectModbusForSession(back.modbus, A)), ['p1', 'p2', 'p3'])
  assert.deepEqual(pointIds(projectModbusForSession(back.modbus, B)), ['pb'])
})

test('fold can update share flags carried on the projection', () => {
  const { modbus } = claimLegacyPrivate(legacyFlat(), A)
  const viewA = projectModbusForSession(modbus, A)
  viewA.share = { enabled: true, visualization: true }
  const folded = foldModbusFromSession(modbus, viewA, A)
  assert.equal(folded.share.enabled, true)
  assert.equal(folded.share.visualization, true)
  assert.deepEqual(vizIds(projectModbusForSession(folded, B)), ['v1'])
})

test('first writer stamps privateClaimSessionId so legacy claim cannot fire later', () => {
  const fresh = normalizeModbus({ version: 3 })
  const view = projectModbusForSession(fresh, B)
  view.points = [{ id: 'pb', connectionId: 'c1', deviceId: 'd1', address: 1 }]
  const folded = foldModbusFromSession(fresh, view, B)
  assert.equal(folded.privateClaimSessionId, B)
  assert.equal(claimLegacyPrivate(folded, A).claimed, false)
  assert.equal(pointIds(projectModbusForSession(folded, A)).length, 0)
})
