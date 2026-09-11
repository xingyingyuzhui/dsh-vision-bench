import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function fail(msg) {
  console.error('pack:check failed:', msg)
  process.exit(1)
}

const required = ['host.js', 'tools.js', 'client.js', 'README.md', 'LICENSE']
for (const f of required) {
  if (!existsSync(join(root, f))) fail(`missing ${f}`)
}

const client = readFileSync(join(root, 'client.js'), 'utf8')
if (!client.includes('Do not edit by hand') && !client.includes('__ModuleLoader__')) {
  fail('client.js does not look like the generated bundle')
}
const chipSingle = `'v${pkg.version}'`
const chipDouble = `"v${pkg.version}"`
if (!client.includes(chipSingle) && !client.includes(chipDouble)) {
  fail(`client.js version chip does not match package.json ${pkg.version}`)
}

const banned = ['__pycache__', '.pyc', 'coverage/', 'node_modules/', 'annotate-jsdoc', 'split-modbus-context']
for (const b of banned) {
  if ((pkg.files || []).some((f) => String(f).includes(b))) fail(`files[] must not include ${b}`)
}
for (const temp of ['scripts/annotate-jsdoc.mjs', 'scripts/split-modbus-context.mjs']) {
  if (existsSync(join(root, temp))) fail(`temporary migration script must not ship: ${temp}`)
}

console.log('pack:check ok', `${pkg.name}@${pkg.version}`)
