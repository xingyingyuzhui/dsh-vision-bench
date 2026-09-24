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
      severity: 'error',
      comment: 'P5-3: orphans are errors; exact-path allowlist only.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)index\\.mjs$',
          '\\.d\\.ts$',
          '(^|/)scripts/',
          '(^|/)test/',
          // Documented ledger / optional adapter kept for package consumers.
          '(^|/)src/ui/components/component-registry\\.mjs$',
          '(^|/)src/infrastructure/modbus/verify-telemetry-adapter\\.mjs$',
        ],
      },
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
      comment: 'UI and view facades must not touch Node I/O or serial transports.',
      from: {
        path: '(^|/)(src/ui/|bench-hmi\\.mjs$|bench-live\\.mjs$|bench-view\\.mjs$|bench-frames-view\\.mjs$|bench-visualization-view\\.mjs$)',
      },
      to: {
        path: '(serialport|modbus-serial|node:child_process|node:fs|fs/promises)',
        dependencyTypes: ['npm', 'core'],
      },
    },
    {
      name: 'ui-components-no-features',
      severity: 'error',
      comment: 'P5-1: public components must not import feature modules.',
      from: { path: '(^|/)src/ui/components/' },
      to: { path: '(^|/)src/ui/(debug|hmi|monitor|settings|workspace)/' },
    },
    {
      name: 'ui-patterns-no-features',
      severity: 'error',
      comment: 'P5-1: patterns must not import feature modules.',
      from: { path: '(^|/)src/ui/patterns/' },
      to: { path: '(^|/)src/ui/(debug|hmi|monitor|settings|workspace)/' },
    },
    {
      name: 'ui-no-direct-vendor-packages',
      severity: 'error',
      comment: 'P5-1: UI must bind vendors through src/ui/vendor/*-runtime.mjs.',
      from: {
        path: '(^|/)src/ui/',
        pathNot: '(^|/)src/ui/vendor/',
      },
      to: {
        path: '^(echarts|gridstack|uplot|@codemirror/|@tanstack/)',
      },
    },
    {
      name: 'no-prod-to-test',
      severity: 'error',
      from: { pathNot: '(^|/)test/' },
      to: { path: '(^|/)test/' },
    },
    {
      name: 'domain-no-bench-facades',
      severity: 'error',
      comment: '0.22: domain must not import bench-* facades.',
      from: { path: '(^|/)src/domain/' },
      to: { path: '(^|/)bench-' },
    },
    {
      name: 'ui-no-bench-facades',
      severity: 'error',
      comment: 'ADR-024: Client UI must import src/, not bench-* facades.',
      from: { path: '(^|/)src/ui/' },
      to: { path: '(^|/)bench-' },
    },
    {
      name: 'application-no-bench-facades',
      severity: 'error',
      comment: 'ADR-024: application layer must import src/, not bench-* facades.',
      from: { path: '(^|/)src/application/' },
      to: { path: '(^|/)bench-' },
    },
    {
      name: 'infrastructure-no-bench-facades',
      severity: 'error',
      comment: 'ADR-024: infrastructure layer must import src/, not bench-* facades.',
      from: { path: '(^|/)src/infrastructure/' },
      to: { path: '(^|/)bench-' },
    },
    {
      name: 'interfaces-no-bench-facades',
      severity: 'error',
      comment: 'ADR-024: interfaces layer must import src/, not bench-* facades.',
      from: { path: '(^|/)src/interfaces/' },
      to: { path: '(^|/)bench-' },
    },
    {
      name: 'agent-tool-no-store-or-io',
      severity: 'error',
      comment: 'Agent proxy may not import store, broker or transport.',
      from: { path: '^src/interfaces/agent/' },
      to: {
        path: '(^|/)(src/infrastructure/(store|modbus)/|bench-store|bench-io-broker|bench-modbus-transport|runtime/io/)',
      },
    },
    {
      name: 'infrastructure-no-application',
      severity: 'error',
      comment:
        'Infrastructure must not depend on application. Known leftovers are narrowed by infrastructure-application-edge-config-scope and infrastructure-application-edge-host-client.',
      from: { path: '(^|/)src/infrastructure/' },
      to: {
        path: '(^|/)src/application/',
        pathNot: [
          // journal-store.mjs + serial-monitor.mjs → config-scope-service.mjs (session projection of a stored pack).
          '(^|/)src/application/modbus/config-scope-service\\.mjs$',
          // vision-host-client.mjs → command-contract / lossless-json / host-command-result
          // (dispatch errors and correlated result normalization).
          '(^|/)src/application/commands/command-contract\\.mjs$',
          '(^|/)src/application/commands/lossless-json\\.mjs$',
          '(^|/)src/application/commands/host-command-result\\.mjs$',
        ],
      },
    },
    {
      name: 'infrastructure-application-edge-config-scope',
      severity: 'error',
      comment:
        'Only journal-store.mjs and serial-monitor.mjs may import config-scope-service.mjs. config-scope-service stays in application because it imports config-scope-claim.mjs.',
      from: {
        path: '(^|/)src/infrastructure/',
        pathNot: [
          '(^|/)src/infrastructure/store/journal-store\\.mjs$',
          '(^|/)src/infrastructure/modbus/serial-monitor\\.mjs$',
        ],
      },
      to: { path: '(^|/)src/application/modbus/config-scope-service\\.mjs$' },
    },
    {
      name: 'infrastructure-application-edge-host-client',
      severity: 'error',
      comment:
        'Only vision-host-client.mjs may import command-contract, lossless-json, and host-command-result.',
      from: {
        path: '(^|/)src/infrastructure/',
        pathNot: ['(^|/)src/infrastructure/host/vision-host-client\\.mjs$'],
      },
      to: {
        path: '(^|/)src/application/commands/(command-contract|lossless-json|host-command-result)\\.mjs$',
      },
    },
    {
      name: 'ui-no-application',
      severity: 'error',
      comment:
        'UI must not import the application layer. ui/client → infrastructure/host/vision-rpc-client is allowed (infrastructure, not application) and is the Fetch dispatch path.',
      from: { path: '(^|/)src/ui/' },
      to: { path: '(^|/)src/application/' },
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
