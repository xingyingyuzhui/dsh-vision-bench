// @ts-check
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, parse as parsePath } from 'node:path'
import test from 'node:test'
import { normalizeCwd, sameCwd } from '../../src/shared/path-normalize.mjs'

const root = join(tmpdir(), `dvb-pathnorm-${Date.now()}`)

test.before(() => {
  mkdirSync(join(root, 'ws', 'sub'), { recursive: true })
  try {
    symlinkSync(join(root, 'ws'), join(root, 'ws-link'))
  } catch {
    /* symlink may be unavailable */
  }
})

test.after(() => {
  rmSync(root, { recursive: true, force: true })
})

test('normalizeCwd 去掉结尾斜杠', () => {
  assert.equal(normalizeCwd(`${root}/ws/`), normalizeCwd(`${root}/ws`))
  assert.equal(normalizeCwd(`${root}/ws///`), normalizeCwd(`${root}/ws`))
})

test('normalizeCwd 把相对路径解析为绝对路径', () => {
  const rel = normalizeCwd('.')
  assert.ok(isAbsolute(rel), '应解析为绝对路径')
  // 根目录（POSIX `/` 或 Windows `C:\`）允许保留尾斜杠，其它路径一律去掉
  const root = parsePath(rel).root
  const endsWithSep = rel.endsWith('/') || rel.endsWith('\\')
  assert.equal(endsWithSep, rel === root)
})

test('normalizeCwd 空值与非法值返回空串', () => {
  assert.equal(normalizeCwd(''), '')
  assert.equal(normalizeCwd('   '), '')
  assert.equal(normalizeCwd(null), '')
  assert.equal(normalizeCwd(undefined), '')
  assert.equal(normalizeCwd(42), '')
})

test('normalizeCwd 解析符号链接（macOS 上 /tmp -> /private/tmp）', () => {
  const viaReal = normalizeCwd(join(root, 'ws'))
  const viaLink = normalizeCwd(join(root, 'ws-link'))
  if (viaLink === '') return // 符号链接不可用则跳过
  assert.equal(viaLink, viaReal)
})

test('normalizeCwd 对不存在的路径不抛错', () => {
  const missing = join(root, 'does', 'not', 'exist')
  assert.doesNotThrow(() => normalizeCwd(missing))
  assert.ok(normalizeCwd(missing).includes('does'))
})

test('sameCwd 对同一目录的不同拼写返回 true', () => {
  assert.equal(sameCwd(join(root, 'ws'), join(root, 'ws')), true)
  assert.equal(sameCwd(join(root, 'ws'), `${join(root, 'ws')}/`), true)
})

test('sameCwd 对不同目录返回 false', () => {
  assert.equal(sameCwd(join(root, 'ws'), join(root, 'ws', 'sub')), false)
})

test('sameCwd 任一侧为空时返回 false（不允许空 cwd 通配）', () => {
  assert.equal(sameCwd('', join(root, 'ws')), false)
  assert.equal(sameCwd(join(root, 'ws'), ''), false)
  assert.equal(sameCwd('', ''), false)
  assert.equal(sameCwd(null, undefined), false)
})
