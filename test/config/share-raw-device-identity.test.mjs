import assert from 'node:assert/strict'
import test from 'node:test'
import { applyShareFlags } from '../../src/application/modbus/config-scope-service.mjs'
import { applyShare } from '../../src/application/config/config-share-mutations.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

/**
 * Raw fixture — never passed through saveWorkspace/normalize, so a private
 * twin pair of d1 rows is still present when share publish runs.
 */
function rawModbusWithTwinD1() {
  return {
    version: 3,
    share: { enabled: false, connections: false, points: false, visualization: false },
    connections: [rtuSim('c1', 'COM3')],
    devices: [],
    points: [],
    sessionConfigs: {
      s1: {
        connections: [rtuSim('c1', 'COM3')],
        devices: [device('d1', 'c1', 1)],
        points: [hrPoint('p1', 'c1', 'd1', 0)],
      },
      s2: {
        connections: [rtuSim('c1', 'COM3')],
        devices: [device('d1', 'c1', 9)],
        points: [],
      },
    },
    privateClaimSessionId: 's1',
  }
}

test('publish connections with raw twin d1 is CONFLICT and input is unchanged', () => {
  const modbus = rawModbusWithTwinD1()
  const before = JSON.parse(JSON.stringify(modbus))
  // s1 publishes its private connections while s2 also has private d1 — but
  // publish REPLACES the shared category with s1's slice (not a concat of all
  // sessions). Twin inside ONE raw candidate layer is what we need.
  // Build a single layer that already contains two d1 rows:
  const twinLayer = {
    version: 3,
    share: { enabled: false, connections: false, points: false, visualization: false },
    connections: [rtuSim('c1', 'COM3')],
    devices: [],
    points: [],
    sessionConfigs: {
      s1: {
        connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
        devices: [device('d1', 'c1', 1), device('d1', 'c2', 2)],
        points: [],
      },
    },
    privateClaimSessionId: 's1',
  }
  const twinBefore = JSON.parse(JSON.stringify(twinLayer))
  const ran = applyShareFlags(twinLayer, 's1', { enabled: true, connections: true }, {})
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.ok(ran.conflicts?.length >= 1)
  assert.equal(ran.conflicts[0].deviceId, 'd1')
  assert.deepEqual(twinLayer, twinBefore, 'input must not be mutated')
  // Non-twin publish is fine
  const ok = applyShareFlags(
    {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        s1: { connections: [rtuSim('c1', 'COM3')], devices: [device('d1', 'c1', 1)], points: [] },
      },
      privateClaimSessionId: 's1',
    },
    's1',
    { enabled: true, connections: true },
    {},
  )
  assert.equal(ok.ok, true, JSON.stringify(ok))
  void before
  void modbus
})

test('applyShare failure preserves conflicts for the command exit', () => {
  const workspace = {
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        s1: {
          connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
          devices: [device('d1', 'c1', 1), device('d1', 'c2', 2)],
          points: [],
        },
      },
      privateClaimSessionId: 's1',
    },
  }
  const ran = applyShare(workspace, 'update', { enabled: true, connections: true }, 's1')
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.ok(Array.isArray(ran.conflicts) && ran.conflicts[0]?.deviceId === 'd1')
  assert.ok(!('workspace' in ran) || ran.workspace == null)
})

test('replace semantics: shared d1 replaced by one private d1 is not a twin', () => {
  const ran = applyShareFlags(
    {
      version: 3,
      share: { enabled: true, connections: true, points: false, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [],
      sessionConfigs: {
        s1: { connections: [rtuSim('c2', 'COM4')], devices: [device('d1', 'c2', 2)], points: [] },
      },
      privateClaimSessionId: 's1',
    },
    's1',
    { enabled: true, connections: true },
    {},
  )
  // Publishing replaces the shared category with s1's single d1 — legal.
  assert.equal(ran.ok, true, JSON.stringify(ran))
})
