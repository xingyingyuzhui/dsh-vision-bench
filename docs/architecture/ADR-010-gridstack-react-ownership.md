# ADR-010: React owns GridStack item DOM

## Status

Accepted (0.25.x)

## Context

GridStack defaults to creating and destroying widget DOM. That fights React’s ownership of visualization cards and caused save loops when a server layout sync looked like a user drag.

## Decision

1. React renders `.grid-stack-item` children. GridStack only decorates existing nodes.
2. New items: `makeWidget(element)`.
3. Removed items: `removeWidget(element, false)` so React DOM is not deleted by GridStack.
4. Coordinate changes: `grid.batchUpdate()` → `grid.update(el, {x,y,w,h})` → `grid.commit()`.
5. External sync is keyed by a stable `layoutSignature` of `{id,x,y,w,h}`, not by id list alone.
6. While applying a server layout, `onLayout` is suppressed.
7. User drags debounce ~300ms, one in-flight save, merge subsequent changes, clear confirmed drafts, refetch+replay on `CONFIG_DRIFT`, and cancel timers on unmount.
8. Unmount calls `off` and `destroy(false)`.

## Consequences

- Agent `op=layout` can move widgets without remounting React trees.
- Tests use a recording GridStack fake (`setGridRuntime`) rather than string search.
