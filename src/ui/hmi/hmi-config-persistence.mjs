const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const byId = (rows) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]))

export function buildConfigMutationPlan(current, patch) {
  const operations = []
  const currentConnections = byId(current.connections)
  const nextConnections = patch.connections === undefined ? currentConnections : byId(patch.connections)
  const removedConnections = new Set(
    patch.connections === undefined ? [] : [...currentConnections.keys()].filter((id) => !nextConnections.has(id)),
  )

  if (patch.connections !== undefined) {
    for (const connection of nextConnections.values()) {
      const previous = currentConnections.get(connection.id)
      operations.push(
        previous
          ? !same(previous, connection) && {
              operation: 'connection.update',
              target: { connectionId: connection.id },
              value: connection,
            }
          : {
              operation: 'connection.create',
              target: { connectionId: connection.id },
              value: connection,
            },
      )
    }
  }

  const currentDevices = byId(current.devices)
  const nextDevices = patch.devices === undefined ? currentDevices : byId(patch.devices)
  const removedDevices = new Set(
    patch.devices === undefined
      ? []
      : [...currentDevices.keys()].filter((id) => {
          const device = currentDevices.get(id)
          return !nextDevices.has(id) && !removedConnections.has(device.connectionId)
        }),
  )

  if (patch.devices !== undefined) {
    for (const device of nextDevices.values()) {
      const previous = currentDevices.get(device.id)
      operations.push(
        previous
          ? !same(previous, device) && {
              operation: 'device.update',
              target: { connectionId: device.connectionId, deviceId: device.id },
              value: device,
            }
          : {
              operation: 'device.create',
              target: { connectionId: device.connectionId, deviceId: device.id },
              value: device,
            },
      )
    }
  }

  if (patch.points !== undefined) {
    const currentPoints = byId(current.points)
    const nextPoints = byId(patch.points)
    const added = []
    const updated = []
    const removed = []
    for (const point of nextPoints.values()) {
      const previous = currentPoints.get(point.id)
      if (!previous) added.push(point)
      else if (!same(previous, point)) updated.push(point)
    }
    for (const point of currentPoints.values()) {
      if (
        !nextPoints.has(point.id) &&
        !removedConnections.has(point.connectionId) &&
        !removedDevices.has(point.deviceId)
      ) {
        removed.push(point.id)
      }
    }
    if (added.length) operations.push({ operation: 'points.add', target: {}, value: { points: added } })
    if (updated.length) operations.push({ operation: 'points.update', target: {}, value: { points: updated } })
    if (removed.length) operations.push({ operation: 'points.remove', target: {}, value: { ids: removed } })
  }

  for (const id of removedDevices) {
    const device = currentDevices.get(id)
    operations.push({
      operation: 'device.remove',
      target: { connectionId: device.connectionId, deviceId: id },
      value: {},
    })
  }
  for (const id of removedConnections) {
    operations.push({ operation: 'connection.remove', target: { connectionId: id }, value: {} })
  }

  return operations.filter(Boolean)
}

export function buildRuntimePatch(current, patch) {
  const runtime = {}
  for (const key of ['activeConnectionId', 'activeDeviceId']) {
    if (patch[key] !== undefined) runtime[key] = patch[key]
  }
  for (const key of ['pollingByConnection', 'framesByConnection']) {
    if (!patch[key] || typeof patch[key] !== 'object') continue
    const changed = {}
    for (const [id, value] of Object.entries(patch[key])) {
      if (!same(current[key]?.[id], value)) changed[id] = value
    }
    if (Object.keys(changed).length) runtime[key] = changed
  }
  return runtime
}

export async function persistHmiPatch(client, current, patch) {
  const operations = buildConfigMutationPlan(current, patch)
  let configVersion = current.configVersion || 1
  let last = null
  for (const item of operations) {
    last = await client.mutateConfig(item.operation, item.target, item.value, configVersion)
    if (!last || last.ok === false) return last
    configVersion = last.nextConfigVersion || last.configVersion || configVersion + 1
  }
  const runtimePatch = buildRuntimePatch(current, patch)
  if (Object.keys(runtimePatch).length) {
    const runtime = await client.persistRuntime(runtimePatch)
    if (!runtime || runtime.ok === false) return runtime
    last = runtime
  }
  return last || { ok: true, unchanged: true }
}
