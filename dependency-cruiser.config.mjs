/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  options: {
    doNotFollow: {
      path: ['node_modules', 'client.js', 'coverage', 'dist'],
    },
    tsPreCompilationDeps: false,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['main', 'types', 'typings'],
    },
  },
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Phase 2: zero circular dependencies required.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'info',
      from: { orphan: true, pathNot: ['(^|/)index\\.mjs$', '\\.d\\.ts$', '(^|/)scripts/', '(^|/)test/'] },
      to: {},
    },
    {
      name: 'domain-no-upward',
      severity: 'error',
      from: { path: '(^|/)src/domain/' },
      to: { path: '(^|/)src/(application|infrastructure|interfaces|ui)/' },
    },
    {
      name: 'application-no-ui-or-interfaces',
      severity: 'error',
      from: { path: '(^|/)src/application/' },
      to: { path: '(^|/)src/(interfaces|ui)/' },
    },
    {
      name: 'infrastructure-no-ui',
      severity: 'error',
      from: { path: '(^|/)src/infrastructure/' },
      to: { path: '(^|/)src/ui/' },
    },
    {
      name: 'ui-no-direct-io',
      severity: 'error',
      from: { path: '(^|/)(src/ui|bench-hmi|bench-live|bench-view|bench-frames-view|bench-visualization-view)\\.mjs' },
      to: {
        path: '(serialport|modbus-serial|node:child_process|node:fs|fs/promises)',
        dependencyTypes: ['npm', 'core'],
      },
    },
    {
      name: 'no-prod-to-test',
      severity: 'error',
      from: { pathNot: '(^|/)test/' },
      to: { path: '(^|/)test/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Harness peer packages (@deepseek-ai/*) resolve at runtime inside DSH, not in this package.',
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: '^@deepseek-ai/',
      },
    },
  ],
}
