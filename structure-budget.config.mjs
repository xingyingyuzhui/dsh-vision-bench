/**
 * Structure budget for hand-maintained sources (plan task P0-1 / P0-2).
 *
 * Three groups are measured. Each group has a soft `warn` line and a hard
 * `error` line. A file over the hard line must be listed in `allow`, and every
 * allowlist entry carries the current line count as a `max` ratchet: a listed
 * file may shrink but never grow. Once a file drops back under the hard line it
 * must be removed from the list, so the allowlist cannot rot.
 *
 * Wildcards are rejected by the checker: a newly oversized file must fail the
 * build rather than slip into an existing pattern.
 *
 * `stage` records the plan task that removes the entry. See
 * docs/VISION_STRUCTURE_AND_TEST_REFACTOR_PLAN.md for the task definitions.
 */
export default {
  groups: [
    {
      name: 'production',
      label: '人工维护生产文件',
      dirs: ['src', 'runtime', 'scripts'],
      suffixes: ['.mjs', '.js'],
      rootPattern: '^(host|tools)\\.js$',
      warn: 400,
      error: 500,
      allow: [],
    },
    {
      name: 'facade',
      label: '根目录兼容门面',
      rootPattern: '^bench-.*\\.mjs$',
      suffixes: ['.mjs'],
      warn: 60,
      error: 80,
      allow: [
      ],
    },
    {
      name: 'test',
      label: '测试文件',
      dirs: ['test'],
      suffixes: ['.test.mjs'],
      warn: 350,
      error: 500,
      allow: [],
    },
  ],
}
