import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeJsonAtomicSync } from '../persistence/atomic-json.mjs'
import { storeDir } from './bindings-store.mjs'

export const globalSharePath = (home) => join(storeDir(home), 'global-share.json')

export const emptyGlobalShare = () => ({
  enabled: false,
  connections: false,
  points: false,
  visualization: false,
})

export const normalizeGlobalShare = (input) => {
  const src = input && typeof input === 'object' ? input : {}
  return {
    enabled: src.enabled === true,
    connections: src.connections === true,
    points: src.points === true,
    visualization: src.visualization === true,
  }
}

export const loadGlobalShare = (home) => {
  try {
    return normalizeGlobalShare(JSON.parse(readFileSync(globalSharePath(home), 'utf8')))
  } catch {
    return emptyGlobalShare()
  }
}

export const saveGlobalShare = (home, input) => {
  const share = normalizeGlobalShare(input)
  mkdirSync(storeDir(home), { recursive: true })
  writeJsonAtomicSync(globalSharePath(home), share)
  return { ok: true, share }
}
