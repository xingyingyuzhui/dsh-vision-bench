import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Every fs access goes through the same require cache as the test harness, so
// failures can be injected by patching node:fs (see test/preset/transaction.test.mjs).
const _require = createRequire(import.meta.url)
export const _readFileSync = (...a) => _require('node:fs').readFileSync(...a)
export const _writeFileSync = (...a) => _require('node:fs').writeFileSync(...a)
export const _copySync = (...a) => _require('node:fs').copyFileSync(...a)
export const _renameSync = (...a) => _require('node:fs').renameSync(...a)
export const _unlinkSync = (...a) => _require('node:fs').unlinkSync(...a)
export const _mkdirSync = (...a) => _require('node:fs').mkdirSync(...a)
export const _existsSync = (...a) => _require('node:fs').existsSync(...a)

export const PRESET_BACKUP_FAILED = 'PRESET_BACKUP_FAILED'
export const PRESET_WRITE_FAILED = 'PRESET_WRITE_FAILED'
export const PRESET_RESTORE_FAILED = 'PRESET_RESTORE_FAILED'

export const MARKER = '.dsh-vision-bench'
export const AFFECTED_FILES = ['agent.cordis.yml', 'preset.yml', MARKER]

/**
 * Task9/0.18.1: every existing file must back up successfully; any failure aborts.
 * @param {string} dir
 * @param {string} presetId
 */
export function createBackup(dir, presetId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(dirname(dir), `.${presetId}.backup.${timestamp}`)
  _mkdirSync(backupDir, { recursive: true })
  const files = []
  for (const name of AFFECTED_FILES) {
    const src = join(dir, name)
    if (_existsSync(src)) {
      try {
        _copySync(src, join(backupDir, name))
        files.push(name)
      } catch (e) {
        const err = new Error('复制备份失败 ' + name + ': ' + String((e && e.message) || e))
        // @ts-ignore
        err.backupDir = backupDir
        throw err
      }
    }
  }
  return { ok: true, backupDir, files }
}

/**
 * Atomic write: temp file in same dir + rename. On any failure the temp file
 * is removed before the error propagates, so no partial file is left behind.
 * @param {string} file
 * @param {string} text
 * @param {((path: string, data: string) => void) | undefined} [writeImpl]
 */
export function writeAtomic(file, text, writeImpl) {
  const tmp = file + '.tmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const writer = writeImpl || _writeFileSync
  try {
    writer(tmp, text)
    _renameSync(tmp, file)
  } catch (e) {
    try {
      _unlinkSync(tmp)
    } catch {}
    throw e
  }
}

/**
 * Restore every file from backup; files that did not exist before are deleted.
 * @param {string} backupDir
 * @param {string} dir
 * @param {Record<string, boolean>} existedBefore
 */
export function restoreAll(backupDir, dir, existedBefore) {
  for (const name of AFFECTED_FILES) {
    const target = join(dir, name)
    const src = join(backupDir, name)
    if (_existsSync(src)) {
      _copySync(src, target)
    } else if (!existedBefore[name] && _existsSync(target)) {
      _unlinkSync(target)
    }
  }
}

/**
 * @param {string} src
 * @param {string} dest
 */
export function copyDirRecursive(src, dest) {
  _mkdirSync(dest, { recursive: true })
  const fs = _require('node:fs')
  const names = fs.readdirSync(src, { withFileTypes: true })
  for (const ent of names) {
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) copyDirRecursive(from, to)
    else if (!_existsSync(to)) _copySync(from, to)
  }
}

/**
 * @param {unknown} error
 */
export function isAlreadyExistsError(error) {
  const code = error && typeof error === 'object' ? /** @type {any} */ (error).code : ''
  const msg = String((error && /** @type {any} */ (error).message) || error || '')
  return code === 'agent-preset/invalid' && /already exists/.test(msg)
}
