import { endpointFingerprint, ioError, normalizeCom } from '../../bench-io-contract.mjs'
import { createFrameRing } from './frame-ring.mjs'
import { closeModbusClient, openModbusClient, runModbusOp } from './modbus-driver.mjs'
import { attachRtuCapture } from './rtu-capture-adapter.mjs'

export function createConnectionManager({ ModbusRTU, now = () => Date.now() } = {}) {
  const connections = new Map()
  const portOwners = new Map()
  let seq = 0
  // Task1.2/0.19.2: global capture sequence — one strictly increasing order for
  // the "全部连接" projection; never paginate by millisecond timestamps because
  // multiple records can share the same millisecond.
  let captureSeq = 0
  const epochBase = Date.now().toString(36)

  const nextTxId = () => epochBase + ':' + ++seq

  const slotKey = (cwd, connectionId) => String(cwd) + '\0' + String(connectionId)

  const claimPort = (port, cwd, connectionId) => {
    const key = normalizeCom(port)
    if (!key) return ''
    const owner = portOwners.get(key)
    if (owner && (owner.cwd !== cwd || owner.connectionId !== connectionId)) {
      const err = ioError('PORT_IN_USE', '串口被占用: ' + key)
      throw Object.assign(new Error(err.message), err)
    }
    portOwners.set(key, { kind: 'modbus', cwd, connectionId })
    return key
  }

  const releaseOwnedPort = (slot) => {
    const key = slot && slot.ownedPort
    if (!key) return
    const owner = portOwners.get(key)
    if (owner && owner.cwd === slot.cwd && owner.connectionId === slot.connectionId) {
      portOwners.delete(key)
    }
    slot.ownedPort = ''
  }

  const enqueue = (slot, job) => {
    slot.queueTail = slot.queueTail.then(job, job)
    return slot.queueTail
  }

  const getSlot = (cwd, connectionId) => {
    const key = slotKey(cwd, connectionId)
    let slot = connections.get(key)
    if (!slot) {
      slot = {
        key,
        cwd,
        connectionId,
        fingerprint: '',
        endpoint: null,
        ownedPort: '',
        client: null,
        held: false,
        liveState: 'disconnected',
        liveError: '',
        connectedAt: 0,
        lastActivityAt: 0,
        detachCapture: null,
        // Task3/0.19.2: idempotent lifecycle guard + expected-close token
        finalized: false,
        expectedClose: false,
        lifecycleDisposer: null,
        // Task2/0.19.2: PER-SLOT transaction context — no manager-level globals
        activeContext: null,
        capture: createFrameRing(),
        queueTail: Promise.resolve(),
      }
      connections.set(key, slot)
    }
    return slot
  }

  const liveOf = (slot) => ({
    connectionId: slot.connectionId,
    cwd: slot.cwd,
    mode: (slot.endpoint && slot.endpoint.mode) || 'rtu',
    port: slot.ownedPort || (slot.endpoint && slot.endpoint.port) || '',
    state: slot.liveState,
    connectedAt: slot.connectedAt,
    lastActivityAt: slot.lastActivityAt,
    error: slot.liveError,
    epoch: slot.capture.epoch,
  })

  const detach = (slot) => {
    if (slot.detachCapture) {
      try {
        slot.detachCapture()
      } catch {
        /* ignore */
      }
      slot.detachCapture = null
    }
  }

  const attach = (slot) => {
    detach(slot)
    if (!slot.client || !slot.endpoint || slot.endpoint.mode !== 'rtu') return
    slot.detachCapture = attachRtuCapture(slot.client, (direction, buf) => {
      const cur = slot.activeContext || {}
      slot.capture.push({
        direction,
        hex: buf.toString('hex').toUpperCase(),
        byteLength: buf.length,
        cwd: slot.cwd,
        connectionId: slot.connectionId,
        port: slot.ownedPort,
        transactionId: cur.transactionId || '',
        source: cur.source || 'system',
        sessionId: cur.sessionId || '',
        toolCallId: cur.toolCallId || '',
        seq: ++captureSeq,
      })
    })
  }

  // Task3/0.19.2: ONE idempotent teardown — used by close, error and close-listener.
  const finalizeSlot = async (slot, opts = {}) => {
    if (!slot || slot.finalized) return
    slot.finalized = true
    if (slot.lifecycleDisposer) {
      try {
        slot.lifecycleDisposer()
      } catch {
        /* ignore */
      }
      slot.lifecycleDisposer = null
    }
    detach(slot)
    const client = slot.client
    slot.client = null
    await closeModbusClient(client)
    releaseOwnedPort(slot)
    slot.activeContext = null
    slot.held = false
    const reason = opts.reason || 'disconnecting'
    if (!opts.expected) {
      slot.liveState = 'error'
      slot.liveError = opts.error
        ? String(opts.error.message || opts.error)
        : reason === 'error'
          ? '连接异常'
          : slot.liveError
    } else {
      slot.liveState = 'disconnected'
      slot.liveError = ''
      slot.endpoint = null
      slot.fingerprint = ''
    }
    slot.capture.bumpEpoch()
    slot.finalized = false // reusable for the next connect cycle on this slot
  }

  // Task3/0.19.2: watch the underlying client so USB pulls / driver errors are
  // handled in-process; the worker must never die on an emitted error/close.
  const bindLifecycle = (slot) => {
    if (slot.lifecycleDisposer) return
    const client = slot.client
    if (!client || typeof client.on !== 'function') return
    const onError = (error) => {
      if (slot.finalized) return
      slot.liveState = 'error'
      slot.liveError = String((error && error.message) || error)
      void finalizeSlot(slot, { reason: 'error', error, expected: false })
    }
    const onClose = () => {
      if (slot.finalized) return
      if (slot.expectedClose) return // intentional close already handled
      slot.liveState = 'error'
      void finalizeSlot(slot, { reason: 'close', expected: false })
    }
    client.on('error', onError)
    client.on('close', onClose)
    slot.lifecycleDisposer = () => {
      try {
        client.removeListener('error', onError)
      } catch {
        /* ignore */
      }
      try {
        client.removeListener('close', onClose)
      } catch {
        /* ignore */
      }
    }
  }

  const ensureOpen = async (slot, endpoint, signal) => {
    const fp = endpointFingerprint(endpoint)
    if (slot.fingerprint && slot.fingerprint !== fp) {
      slot.expectedClose = true
      await finalizeSlot(slot, { reason: 'reconnect', expected: true })
      slot.expectedClose = false
    }
    if (endpoint.mode === 'rtu') {
      const owned = claimPort(endpoint.port, slot.cwd, slot.connectionId)
      slot.ownedPort = owned || slot.ownedPort
    }
    slot.fingerprint = fp
    slot.endpoint = endpoint
    if (!slot.client) {
      slot.liveState = 'connecting'
      try {
        slot.client = await openModbusClient(ModbusRTU, endpoint, signal)
        slot.liveState = 'connected'
        slot.liveError = ''
        slot.connectedAt = now()
        slot.capture.bumpEpoch()
        bindLifecycle(slot)
        attach(slot)
      } catch (error) {
        slot.expectedClose = true
        await finalizeSlot(slot, { reason: 'connect-fail', expected: false, error })
        slot.expectedClose = false
        slot.liveState = 'error'
        slot.liveError = String((error && error.message) || error)
        throw error
      }
    }
    slot.held = true
    slot.lastActivityAt = now()
  }

  const runOnSlot = async (request, endpoint, signal) => {
    const slot = getSlot(request.cwd, request.connectionId)
    return enqueue(slot, async () => {
      if (signal && signal.aborted) {
        const err = ioError('CANCELLED', '已取消')
        throw Object.assign(new Error(err.message), err)
      }
      await ensureOpen(slot, endpoint, signal)
      const transactionId = nextTxId()
      // Task2/0.19.2: context lives ON the slot — concurrent COM3/COM4 requests
      // can never clobber each other's source/transaction ids.
      slot.activeContext = {
        transactionId,
        source: request.source || 'manual',
        sessionId: request && request.sessionId ? String(request.sessionId).slice(0, 64) : '',
        toolCallId: request && request.toolCallId ? String(request.toolCallId).slice(0, 64) : '',
      }
      try {
        if (signal && signal.aborted) {
          const err = ioError('CANCELLED', '已取消')
          throw Object.assign(new Error(err.message), { ...err, transactionId })
        }
        const ran = await runModbusOp(slot.client, { ...request, endpoint }, signal)
        slot.lastActivityAt = now()
        return { ...ran, transactionId }
      } catch (error) {
        if (error && typeof error === 'object') error.transactionId = error.transactionId || transactionId
        if (slot.held) {
          slot.liveState = 'error'
          slot.liveError = String((error && error.message) || error)
          slot.expectedClose = true
          await finalizeSlot(slot, { reason: 'op-error', expected: false, error })
          slot.expectedClose = false
        } else {
          slot.expectedClose = true
          await finalizeSlot(slot, { reason: 'op-error', expected: true, error })
          slot.expectedClose = false
        }
        throw error
      } finally {
        slot.activeContext = null
      }
    })
  }

  return {
    nextTxId,
    portOwners,
    connections,
    // kept for back-compat: per-slot contexts replace the old setSource()
    setSource() {},
    async modbus(request, endpoint, signal) {
      return runOnSlot(request, endpoint, signal)
    },
    async openConnection(request, endpoint, signal) {
      const slot = getSlot(request.cwd, request.connectionId)
      return enqueue(slot, async () => {
        await ensureOpen(slot, endpoint, signal)
        slot.held = true
        return liveOf(slot)
      })
    },
    async closeConnection(cwd, connectionId) {
      const slot = connections.get(slotKey(cwd, connectionId))
      if (!slot) return { ok: true, state: 'disconnected' }
      await enqueue(slot, async () => {
        slot.expectedClose = true
        try {
          await finalizeSlot(slot, { reason: 'close', expected: true })
        } finally {
          slot.expectedClose = false
        }
      })
      return liveOf(slot)
    },
    status(cwd, connectionId) {
      if (connectionId) {
        const slot = connections.get(slotKey(cwd, connectionId))
        return slot ? liveOf(slot) : { connectionId, cwd, state: 'disconnected', port: '', error: '' }
      }
      const out = []
      for (const slot of connections.values()) {
        if (String(slot.cwd) !== String(cwd)) continue
        if (slot.liveState === 'disconnected' && !slot.held && !slot.capture.bufferCount) continue
        out.push(liveOf(slot))
      }
      return { connections: out }
    },
    feedCapture(cwd, connectionId, since, max) {
      const cap = Math.min(500, Math.max(1, Math.trunc(Number(max) || 200)))
      if (connectionId) {
        const slot = connections.get(slotKey(cwd, connectionId))
        if (!slot)
          return {
            open: false,
            lines: [],
            items: [],
            cursor: 0,
            lastId: 0,
            hasMore: false,
            dropped: 0,
            total: 0,
            port: '',
            state: 'disconnected',
          }
        const fed = slot.capture.feed(since, cap)
        return {
          open: slot.liveState === 'connected',
          state: slot.liveState,
          port: slot.ownedPort,
          connectionId: slot.connectionId,
          epoch: fed.epoch,
          items: fed.items,
          cursor: fed.cursor,
          hasMore: fed.hasMore,
          dropped: fed.dropped,
          oldestCursor: fed.oldestCursor,
          latestCursor: fed.latestCursor,
          bufferCount: fed.bufferCount,
          // back-compat aliases
          lines: fed.items,
          lastId: fed.cursor,
          total: slot.capture.all().length,
        }
      }
      // Task1.2/0.19.2: 全部连接 — strictly ordered by the global capture seq.
      const after = Number(since) > 0 ? Number(since) : 0
      const rows = []
      let oldestSeq = Infinity
      let latestSeq = 0
      for (const slot of connections.values()) {
        if (String(slot.cwd) !== String(cwd)) continue
        for (const item of slot.capture.all()) {
          const s = Number(item.seq) || item.id
          oldestSeq = Math.min(oldestSeq, s)
          latestSeq = Math.max(latestSeq, s)
          rows.push({ ...item, _seq: s })
        }
      }
      rows.sort((a, b) => a._seq - b._seq || String(a.connectionId).localeCompare(String(b.connectionId)))
      let dropped = 0
      if (after > 0 && after < oldestSeq && oldestSeq !== Infinity && oldestSeq > 1) {
        dropped = Math.max(0, oldestSeq - 1 - after)
      }
      const items = rows.filter((r) => r._seq > after).slice(0, cap)
      const lastReturned = items.length ? items[items.length - 1]._seq : after
      return {
        open: items.length > 0,
        items,
        cursor: lastReturned,
        hasMore: lastReturned < latestSeq,
        dropped,
        oldestCursor: oldestSeq === Infinity ? 0 : oldestSeq,
        latestCursor: latestSeq,
        bufferCount: rows.length,
        // back-compat aliases
        lines: items,
        lastId: lastReturned,
        total: rows.length,
      }
    },
    async release(cwd, connectionId) {
      return this.closeConnection(cwd, connectionId)
    },
    async cancelSlot(cwd, connectionId) {
      const slot = connections.get(slotKey(cwd, connectionId))
      if (!slot || slot.held) return
      slot.expectedClose = true
      try {
        await finalizeSlot(slot, { reason: 'cancel', expected: true })
      } finally {
        slot.expectedClose = false
      }
    },
    async stop() {
      for (const slot of [...connections.values()]) {
        slot.expectedClose = true
        try {
          await finalizeSlot(slot, { reason: 'stop', expected: true })
        } finally {
          slot.expectedClose = false
        }
      }
      connections.clear()
      portOwners.clear()
    },
  }
}
