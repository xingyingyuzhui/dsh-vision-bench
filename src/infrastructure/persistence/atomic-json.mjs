// @ts-check
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
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
