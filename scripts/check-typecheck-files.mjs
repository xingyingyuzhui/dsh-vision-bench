import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const CORE_TYPECHECK_DIRS = [
  'src/domain',
  'src/application/config',
  'src/application/commands',
  'src/application/modbus',
  'src/infrastructure/persistence',
  'src/infrastructure/host',
  'src/interfaces',
]

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
export function listMjsFiles(dir, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) listMjsFiles(full, acc)
    else if (name.endsWith('.mjs')) acc.push(full)
  }
  return acc
}

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function collectCoreMjs(projectRoot = root) {
  return CORE_TYPECHECK_DIRS.flatMap((dir) => listMjsFiles(join(projectRoot, dir)))
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
export function findNocheckFiles(files) {
  const hits = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (/@ts-nocheck\b/.test(src)) hits.push(file)
  }
  return hits
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
export function findUncheckedFiles(files) {
  const hits = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!/@ts-check\b/.test(src)) hits.push(file)
  }
  return hits
}

/**
 * @param {string[]} files
 * @param {string} listOutput
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function findMissingFromTscList(files, listOutput, projectRoot = root) {
  const missing = []
  for (const file of files) {
    const abs = file
    const rel = relative(projectRoot, file).replaceAll('\\', '/')
    if (!listOutput.includes(abs) && !listOutput.includes(rel)) missing.push(rel)
  }
  return missing
}

/**
 * @param {string} projectRoot
 * @returns {{ ok: boolean, nocheck: string[], unchecked: string[], missing: string[] }}
 */
export function checkTypecheckFiles(projectRoot = root) {
  const coreFiles = collectCoreMjs(projectRoot)
  const nocheck = findNocheckFiles(coreFiles).map((file) => relative(projectRoot, file).replaceAll('\\', '/'))
  const unchecked = findUncheckedFiles(coreFiles).map((file) => relative(projectRoot, file).replaceAll('\\', '/'))
  const out = execFileSync('npx', ['tsc', '-p', 'tsconfig.check.json', '--listFilesOnly'], {
    encoding: 'utf8',
    cwd: projectRoot,
  })
  const missing = findMissingFromTscList(coreFiles, out, projectRoot)
  return { ok: nocheck.length === 0 && unchecked.length === 0 && missing.length === 0, nocheck, unchecked, missing }
}

function main() {
  const result = checkTypecheckFiles(root)
  if (result.nocheck.length) {
    console.error('core typecheck dirs must not use @ts-nocheck:')
    for (const file of result.nocheck) console.error(`  ${file}`)
  }
  if (result.unchecked.length) {
    console.error('core typecheck dirs must opt in with @ts-check:')
    for (const file of result.unchecked) console.error(`  ${file}`)
  }
  if (result.missing.length) {
    console.error('core files missing from tsc --listFilesOnly:')
    for (const file of result.missing) console.error(`  ${file}`)
  }
  if (!result.ok) process.exit(1)
  console.log('typecheck file list ok')
  const remaining = listMjsFiles(join(root, 'src')).filter((file) => {
    const rel = relative(root, file).replaceAll('\\', '/')
    if (CORE_TYPECHECK_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return false
    return /@ts-nocheck\b/.test(readFileSync(file, 'utf8'))
  })
  if (remaining.length) {
    console.log('remaining @ts-nocheck outside core gate:')
    for (const file of remaining) console.log(`  ${relative(root, file).replaceAll('\\', '/')}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
