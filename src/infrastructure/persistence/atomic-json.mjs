// @ts-check
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import writeFileAtomic from 'write-file-atomic'

/** Atomically write UTF-8 text (temp + fsync + rename). */
/**
 * @param {any} filePath
 * @param {any} text
 * @returns {any}
 */
export function writeTextAtomicSync(filePath, text) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileAtomic.sync(filePath, text, { encoding: 'utf8', fsync: true })
}

/**
 * @param {any} filePath
 * @param {any} value
 * @param {any} arg
 * @returns {any}
 */
export function writeJsonAtomicSync(filePath, value, { pretty = true } = {}) {
  const text = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value)
  writeTextAtomicSync(filePath, text)
}

/**
 * @param {any} filePath
 * @param {any} fallback
 * @returns {any}
 */
export function readJsonSync(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * @param {any} filePath
 * @param {any} bakPath
 * @returns {any}
 */
export function backupFileSync(filePath, bakPath) {
  if (!existsSync(filePath)) return false
  mkdirSync(dirname(bakPath), { recursive: true })
  copyFileSync(filePath, bakPath)
  return true
}

/** Atomic copy that never overwrites an existing backup. */
/** @param {any} filePath */
function isRegularFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/** @param {any} filePath @param {any} bakPath */
export function backupFileOnceSync(filePath, bakPath) {
  if (isRegularFile(bakPath)) return { ok: true, existed: true }
  if (existsSync(bakPath)) return { ok: false, error: 'backup path is not a file' }
  if (!existsSync(filePath)) return { ok: false, error: 'source missing' }
  mkdirSync(dirname(bakPath), { recursive: true })
  const tmp = `${bakPath}.${process.pid}.tmp`
  copyFileSync(filePath, tmp)
  if (existsSync(bakPath)) {
    try {
      unlinkSync(tmp)
    } catch {}
    return { ok: true, existed: true }
  }
  renameSync(tmp, bakPath)
  if (!existsSync(bakPath)) return { ok: false, error: 'backup missing after copy' }
  return { ok: true, existed: false }
}

/**
 * @param {any} fromPath
 * @param {any} toPath
 * @returns {any}
 */
export function replaceFileSync(fromPath, toPath) {
  mkdirSync(dirname(toPath), { recursive: true })
  renameSync(fromPath, toPath)
}

/**
 * @param {any} filePath
 * @returns {any}
 */
export function removeFileSync(filePath) {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    /* ignore */
  }
}
