# ADR-025: Public UI component API contract

## Status

Accepted (0.30.0). Applies to `src/ui/components/**`, `src/ui/patterns/**`, `src/ui/common/**` and `src/ui/vendor/**`.

## Context

ADR-024 established `token → primitive → pattern → feature` and banned new copies of shared chrome, but did not say **how** a public component is shaped. The current eight modules grew independently and disagree on several points:

- `custom-select` exposes `getCustomSelect(React)` (memoised), `renderCustomSelect` (raw DOM) and `createCustomSelect`.
- `primitives` exposes `createPanel/createTabs/createHint(React)` only.
- `modal-dialog` and `save-cancel-buttons` expose both `renderX` (raw DOM with `t`) and `createX(React)`.
- `data-table`, `viz-grid`, `source-editor` expose `createX(React)` only.
- Only `primitives.mjs` declares `@ts-check`; the other seven do not.
- Props are undocumented `any`: callers pass `className`, `style`, `disabled`, `loading`, `aria-*` ad hoc.

Without a written contract, P2-3 (unify component APIs) and P5-2 (ownership gate) have no target to converge on, and every new component re-decides the same questions.

## Decision

### D1. Public entry point is a React factory

```js
/**
 * @param {UiRuntime} React
 * @returns {(props: ButtonProps) => any}
 */
export function createButton(React) { ... }
```

`createX(React)` returns a **stable component type**. Callers must memoise it:

```js
const Button = React.useMemo(() => createButton(React), [React])
```

A page must not call `createX(React)` during every render. `getCustomSelect`'s WeakMap cache is the sanctioned form of this memoisation for components shared across many modules; new components prefer explicit `useMemo` plus a documented `getX(React)` only when the caller count makes it worthwhile.

### D2. `renderX(el, ...)` is limited to pure, hook-free rendering

`renderX` may exist for (a) compatibility with existing callers and (b) tests that assert raw DOM. It **must not** own subscriptions, timers, focus, vendor instances or lifecycle. Anything with a mount/unmount cycle is `createX(React)` only.

Rule of thumb: if the function needs a `useEffect` in the React form, it needs no `renderX`.

### D3. Dependencies are injected through factory parameters

i18n, vendor runtimes and host adapters are passed explicitly:

```js
createSaveCancelGroup(React, t)   // i18n
createVizGrid(React)              // vendor reached through src/ui/vendor/*
```

A public component must not import a global singleton, read `window`, or call `workspace`/RPC/device state. Vendor packages are reached only through `src/ui/vendor/*-runtime.mjs` (dependency-cruiser `ui-no-direct-vendor-packages`).

### D4. Components report intent through props only

Props are the whole contract:

```js
Button({
  variant: 'default' | 'primary' | 'danger' | 'ghost',
  size: 'sm' | 'md',
  loading,
  disabled,
  ariaLabel,
  onClick,
  className,
  children,
})
```

A component never writes workspace/session/config state, never calls RPC, never decides permissions. It renders what it is given and calls back. Business state stays with the feature module.

### D5. Common props are uniform

Every public component that renders an interactive element accepts, with these meanings:

| Prop | Meaning |
|---|---|
| `className` | Appended to the component's own classes; never replaces them |
| `style` | Merged over computed inline style |
| `disabled` | Removes interactivity; must not fire callbacks |
| `loading` | Implies non-interactive (`disabled || loading`), sets `aria-busy`, must not fire callbacks |
| `ariaLabel` / `ariaLabelledBy` | Accessible name; at least one must be provided by the caller for controls without visible text |
| `id` | Caller-supplied id wins; otherwise the component generates a unique one |

Props not listed are component-specific and must be named in the component's JSDoc.

### D6. Accessibility ownership

- The component owns ARIA **structure** (roles, `aria-*` wiring, focus order, Escape handling, focus restore).
- The feature owns ARIA **content** (labels, titles, error copy, i18n text).
- Wait/loading/empty/error states are distinguishable and exposed in the DOM; a component that renders a status must not collapse all three into one node.

### D7. Controlled vs uncontrolled is explicit

A component supports **one** mode per prop. `open`/`value`/`checked` are either fully controlled (parent holds state, component only reports) or fully uncontrolled (component holds state, `defaultX` seeds it). Mixing is a defect, not a feature. Internal-only state (highlight index, hover) is never exposed.

### D8. Errors and i18n fallback

- Components do not `throw` for user data. Invalid props either render an accessible error state or are normalised.
- Missing translation strings fall back to the key, never to `undefined` or an empty label; a missing accessible name is a test failure, not a silent default.
- Callbacks (`onClick`, `onChange`, `onClose`) are optional unless the component is useless without them; when optional, absence must not produce a console error.

### D9. Unmount cleanup is part of the contract

Every listener, observer, timer and vendor instance created by a component is removed on unmount, exactly once. The component's test suite must assert cleanup, not just initial render.

### D10. Types and check mode

- `src/types/ui-runtime.d.ts` declares the minimal React runtime shape (`createElement`, `useState`, `useEffect`, `useId`, `useRef`, `useMemo`, `useCallback`).
- `src/types/ui-components.d.ts` declares public component Props and event types.
- Every module under `src/ui/{components,common,patterns,vendor}/` declares `// @ts-check`, uses JSDoc `@param`/`@returns` referencing those types, and passes `npm run typecheck:ui`.
- `@ts-nocheck` is forbidden; if a module cannot pass, fix the types or reduce the declared runtime surface.

### D11. No barrels

Public modules are imported by direct file path. No `src/ui/components/index.mjs`. This keeps the dependency graph visible to dependency-cruiser and the ownership gate.

### D12. Verification

`scripts/check-component-api.mjs` (added with P5) enforces D1/D2/D3/D10 mechanically where possible: public modules declare `@ts-check`, export at least one `create*` factory, do not import feature directories, and do not import vendor packages directly. Protected-selector ownership is a separate gate (`scripts/check-ui-ownership.mjs`, P5-2 / plan §5.7).

## Consequences

- P2-3 migrates existing components group by group (Select / Dialog / Action / Toggle / Panel-Tabs) without changing visuals or business behaviour.
- `renderX` stays only where a caller or test genuinely needs raw DOM; it shrinks over time instead of growing.
- New components (`button`, `empty-state`, `status-badge`, `patterns/*`) are written directly against this contract.
- UI typecheck becomes a gate for the public layer; feature directories join `tsconfig.ui-check.json` incrementally, without `@ts-nocheck`.
- Components stop being a place where business logic hides: anything needing workspace/RPC state moves back to the feature module.

## References

- ADR-001 (modular monolith), ADR-024 (client primitives and facade retirement)
- `docs/plans/2026-09-15-002-component-and-pattern-inventory.md` (caller evidence and per-component gaps)
- `docs/VISION_COMPONENT_REUSE_AND_ENGINEERING_PLAN.md` §5.2, §5.4, §5.5
