// @ts-check
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { FLASH_ERROR_CODES } from '../../domain/flash/errors.mjs'

/** @param {string} filePath */
export function hashFileSha256(filePath) {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

/**
 * @param {string} root
 * @param {string} dir
 */
export function isTaskSnapshotDir(root, dir) {
  const base = resolve(root)
  const target = resolve(dir)
  if (target === base) return false
  const prefix = base.endsWith(sep) ? base : base + sep
  if (!target.startsWith(prefix)) return false
  const name = target.slice(prefix.length)
  if (name.includes(sep) || name.includes('/') || name.includes('\\')) return false
  return /^[A-Za-z0-9._-]+-[a-f0-9]{8,}$/.test(name)
}

/**
 * Copy a firmware file into a unique staging directory and re-hash it.
 * @param {{
 *   sourcePath: string,
 *   stagingRoot: string,
 *   taskId: string,
 *   expectedSha256: string,
 *   expectedSize: number,
 * }} spec
 */
export function createFirmwareSnapshot(spec) {
  const sourcePath = String(spec?.sourcePath || '')
  const stagingRoot = String(spec?.stagingRoot || '')
  const taskId = String(spec?.taskId || '').replace(/[^A-Za-z0-9._-]/g, '')
  if (!sourcePath || !stagingRoot || !taskId) {
    return {
      ok: false,
      errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_FAILED,
      error: '缺少固件快照参数',
    }
  }
  const ext = extname(sourcePath) || '.hex'
  const dir = join(stagingRoot, `${taskId}-${randomBytes(8).toString('hex')}`)
  try {
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, `firmware${ext}`)
    copyFileSync(sourcePath, dest)
    const size = statSync(dest).size
    const sha256 = hashFileSha256(dest)
    if (Number(spec.expectedSize) !== size || String(spec.expectedSha256) !== sha256) {
      removeFirmwareSnapshot(dir, stagingRoot)
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_MISMATCH,
        error: '固件已变化，请重新确认后烧录',
        dir,
      }
    }
    return { ok: true, path: dest, dir, size, sha256 }
  } catch (error) {
    try {
      removeFirmwareSnapshot(dir, stagingRoot)
    } catch {
      /* best-effort */
    }
    return {
      ok: false,
      errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_FAILED,
      error: error instanceof Error ? error.message : String(error || '无法创建固件快照'),
    }
  }
}

/**
 * Delete one snapshot directory created by createFirmwareSnapshot.
 * @param {string} dir
 * @param {string} stagingRoot
 */
export function removeFirmwareSnapshot(dir, stagingRoot) {
  if (!dir || !stagingRoot) {
    return {
      ok: false,
      errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_CLEANUP_FAILED,
      error: '缺少快照目录',
    }
  }
  if (!isTaskSnapshotDir(stagingRoot, dir)) {
    return {
      ok: false,
      errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_CLEANUP_FAILED,
      error: '拒绝删除非任务快照目录',
    }
  }
  try {
    rmSync(resolve(dir), { recursive: true, force: true })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      errorCode: FLASH_ERROR_CODES.FIRMWARE_SNAPSHOT_CLEANUP_FAILED,
      error: error instanceof Error ? error.message : String(error || '快照清理失败'),
    }
  }
}
