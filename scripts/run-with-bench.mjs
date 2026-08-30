import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function listBenchFacades(projectRoot = root) {
  return readdirSync(projectRoot)
    .filter((name) => name.startsWith('bench-') && name.endsWith('.mjs'))
    .sort()
}

/**
 * @param {string} binRel
 * @param {string[]} args
 */
function run(binRel, args) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules', binRel), ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  process.exit(result.status === null ? 1 : result.status)
}

function main() {
  const cmd = process.argv[2]
  const bench = listBenchFacades(root)
  if (!bench.length) {
    console.error('run-with-bench: no bench-*.mjs facades')
    process.exit(1)
  }
  if (cmd === 'lint') {
    run('@biomejs/biome/bin/biome', [
      'ci',
      'host.js',
      ...bench,
      'src',
      'runtime',
      'scripts',
      'test',
      'docs/architecture',
    ])
    return
  }
  if (cmd === 'deps') {
    run('dependency-cruiser/bin/dependency-cruise.mjs', [
      '--config',
      'dependency-cruiser.config.mjs',
      'src',
      ...bench,
      'host.js',
      'runtime/io',
    ])
    return
  }
  console.error('usage: node scripts/run-with-bench.mjs lint|deps')
  process.exit(2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
