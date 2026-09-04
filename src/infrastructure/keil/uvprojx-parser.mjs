// @ts-check

import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { MAX_MAP_DEFINES } from '../../domain/keil/project-model.mjs'

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  isArray: (name) => ['Target', 'Group', 'File', 'VariousControls'].includes(name),
})

/**
 * Recursively find all descendant objects under a given node with key matching tagName.
 * @param {any} node
 * @param {string} tagName
 * @param {any[]} [acc]
 * @returns {any[]}
 */
export function findDescendants(node, tagName, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const item of node) {
      findDescendants(item, tagName, acc)
    }
    return acc
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === tagName) {
      if (Array.isArray(value)) {
        acc.push(...value)
      } else if (value && typeof value === 'object') {
        acc.push(value)
      }
    } else if (value && typeof value === 'object') {
      findDescendants(value, tagName, acc)
    }
  }
  return acc
}

/**
 * Split IncludePath by semicolon.
 * @param {string} text
 * @returns {string[]}
 */
export function splitIncludePath(text) {
  const out = []
  for (const part of (text || '').split(';')) {
    const item = part.trim()
    if (item) {
      out.push(item)
    }
  }
  return out
}

/**
 * Split Define by semicolon or comma.
 * @param {string} text
 * @param {number} [maxDefines]
 * @returns {string[]}
 */
export function splitDefines(text, maxDefines = MAX_MAP_DEFINES) {
  const out = []
  for (const part of (text || '').replaceAll(';', ',').split(',')) {
    const item = part.trim()
    if (item) {
      out.push(item)
    }
  }
  return out.slice(0, maxDefines)
}

/**
 * Load and parse a .uvprojx file.
 * @param {string} projectPath
 * @returns {Promise<{ xmlRoot: any, filePath: string }>}
 */
export async function parseUvprojxFile(projectPath) {
  const p = resolve(projectPath)
  if (extname(p).toLowerCase() !== '.uvprojx') {
    throw new Error(`仅支持 .uvprojx 文件，当前: ${extname(p)}`)
  }
  let content = ''
  try {
    content = await readFile(p, 'utf8')
  } catch (err) {
    throw new Error(`工程文件不存在: ${p}`)
  }
  const xmlRoot = parser.parse(content)
  return { xmlRoot, filePath: p }
}

/**
 * List Target names in .uvprojx
 * @param {string} projectPath
 * @returns {Promise<Array<{ name: string }>>}
 */
export async function listTargets(projectPath) {
  const { xmlRoot } = await parseUvprojxFile(projectPath)
  const targetNodes = findDescendants(xmlRoot, 'Target')
  /** @type {Array<{ name: string }>} */
  const targets = []
  for (const targetEl of targetNodes) {
    const name = String(targetEl?.TargetName ?? '').trim()
    if (name) {
      targets.push({ name })
    }
  }
  return targets
}

/**
 * Pick a specific Target or the first Target.
 * @param {any} xmlRoot
 * @param {string} [wantedTarget]
 * @returns {{ targetNode: any, targetName: string } | null}
 */
export function pickTarget(xmlRoot, wantedTarget = '') {
  const wanted = (wantedTarget || '').trim()
  const targetNodes = findDescendants(xmlRoot, 'Target')
  for (const targetEl of targetNodes) {
    const name = String(targetEl?.TargetName ?? '').trim()
    if (!name) continue
    if (!wanted || name === wanted) {
      return { targetNode: targetEl, targetName: name }
    }
  }
  return null
}

/**
 * Read includes and defines from VariousControls of a Target.
 * @param {any} targetNode
 * @returns {{ includes: string[], defines: string[] }}
 */
export function readVariousControls(targetNode) {
  const variousControlsList = findDescendants(targetNode, 'VariousControls')
  /** @type {string[]} */
  const includes = []
  /** @type {string[]} */
  const defines = []

  for (const ctrl of variousControlsList) {
    const incRaw = typeof ctrl?.IncludePath === 'string' ? ctrl.IncludePath : ''
    const defRaw = typeof ctrl?.Define === 'string' ? ctrl.Define : ''
    includes.push(...splitIncludePath(incRaw))
    defines.push(...splitDefines(defRaw))
  }

  return { includes, defines }
}

/**
 * Read Groups and Files of a Target.
 * @param {any} targetNode
 * @returns {Array<{ name: string, files: Array<{ name: string, path: string }> }>}
 */
export function readGroups(targetNode) {
  // Look for Groups/Group under target
  const groupsList = findDescendants(targetNode, 'Group')
  /** @type {Array<{ name: string, files: Array<{ name: string, path: string }> }>} */
  const groups = []

  for (const groupEl of groupsList) {
    const gname = String(groupEl?.GroupName ?? '').trim() || '组'
    /** @type {Array<{ name: string, path: string }>} */
    const files = []
    const fileList = findDescendants(groupEl, 'File')

    for (const fileEl of fileList) {
      const fname = String(fileEl?.FileName ?? '').trim()
      const fpath = String(fileEl?.FilePath ?? fname).trim()
      if (!fpath) continue
      files.push({
        name: fname || fpath.split(/[\\/]/).pop() || '',
        path: fpath,
      })
    }

    groups.push({ name: gname, files })
  }

  return groups
}

/**
 * Read OutputDirectory and OutputName from a Target.
 * @param {any} targetNode
 * @returns {{ outputDirectory: string, outputName: string }}
 */
export function readOutputOptions(targetNode) {
  const commonOptions = findDescendants(targetNode, 'TargetCommonOption')
  let outputDirectory = ''
  let outputName = ''

  if (commonOptions.length > 0) {
    const opt = commonOptions[0]
    outputDirectory = String(opt?.OutputDirectory ?? '').trim()
    outputName = String(opt?.OutputName ?? '').trim()
  }

  return { outputDirectory, outputName }
}
