// @ts-check
import { createServer } from 'node:net'

/**
 * Checks if a TCP port is currently available for binding on 127.0.0.1.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isPortAvailable(port) {
  if (!port || port <= 0 || port > 65535) return false

  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => {
      resolve(false)
    })
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * Allocates an available dynamic TCP port on loopback (127.0.0.1).
 * If preferredPort is provided and available, it is returned; otherwise, an ephemeral port is allocated.
 *
 * @param {number} [preferredPort=0]
 * @returns {Promise<number>}
 */
export async function allocateLoopbackPort(preferredPort = 0) {
  if (preferredPort > 0) {
    const isFree = await isPortAvailable(preferredPort)
    if (isFree) return preferredPort
  }

  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', (err) => reject(err))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('无法分配回环端口')))
        return
      }
      const port = addr.port
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}
