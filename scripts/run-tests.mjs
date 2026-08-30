import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Collect `*.test.mjs` under test/. Helpers such as python.mjs, dom-stub.mjs,
 * and fixtures are skipped because they do not use the `.test.mjs` suffix.
 *
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function collectTestFiles(projectRoot = root) {
  const files = []
  walk(join(projectRoot, 'test'), files)
  files.sort((a, b) => a.localeCompare(b))
  return files
}

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function walk(dir, acc) {
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name === 'node_modules' || name === 'fixtures') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (name.endsWith('.test.mjs')) acc.push(full)
  }
}

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function testFileArgs(projectRoot = root) {
  return collectTestFiles(projectRoot).map((file) => relative(projectRoot, file).replaceAll('\\', '/'))
}

function main() {
  const files = testFileArgs(root)
  if (!files.length) {
    console.error('run-tests: no *.test.mjs files under test/')
    process.exit(1)
  }
  const extra = process.argv.slice(2)
  const result = spawnSync(process.execPath, ['--test', ...extra, ...files], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  process.exit(result.status === null ? 1 : result.status)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
