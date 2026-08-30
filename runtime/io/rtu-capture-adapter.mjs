const toBuf = (data) => {
  if (!data) return null
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  try {
    return Buffer.from(data)
  } catch {
    return null
  }
}

export function attachRtuCapture(client, onChunk) {
  const port = client && client._port
  if (!port || typeof port.write !== 'function') return () => {}
  const origWrite = port.write.bind(port)
  port.write = function capturedWrite(data, encoding, cb) {
    const buf = toBuf(data)
    if (buf && buf.length && typeof onChunk === 'function') {
      try {
        onChunk('tx', buf)
      } catch {
        /* ignore */
      }
    }
    return origWrite(data, encoding, cb)
  }
  const serial = port._client
  const onData = (chunk) => {
    const buf = toBuf(chunk)
    if (buf && buf.length && typeof onChunk === 'function') {
      try {
        onChunk('rx', buf)
      } catch {
        /* ignore */
      }
    }
  }
  if (serial && typeof serial.on === 'function') serial.on('data', onData)
  return () => {
    try {
      port.write = origWrite
    } catch {
      /* ignore */
    }
    if (serial && typeof serial.removeListener === 'function') {
      serial.removeListener('data', onData)
    }
  }
}
