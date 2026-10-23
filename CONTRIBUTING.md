# Contributing

## Working motto

**Clean boundaries. One source of truth. Reusable behavior. Polished interactions.**

We treat maintainability and UX quality as part of the feature, not cleanup deferred until later. A change is complete when it works, has a clear owner, avoids duplicate behavior, and fits the editor's established interaction language.

## Before writing code

1. Check `ARCHITECTURE.md` for the current owner of the model, mutation, rendering, tool, layer, timeline, persistence, or UI responsibility.
2. Search the repository for an existing component, service, directive, or helper that already solves part of the problem.
3. Decide where state lives and which boundary performs persistent mutation before adding template handlers.

## Component and reuse guidance

- Pages and shells compose features; they should not accumulate feature-specific controls, algorithms, or gesture state.
- Components own a coherent view and its local interaction state. Services own shared session state, domain commands, or coordination used across view lifetimes. Pure calculations should remain framework-independent.
- Do not create abstractions merely to shorten a file. Extract around a stable responsibility or a real reuse boundary.
- The second implementation of the same behavior is the signal to share it. Prefer a focused primitive over keeping two similar copies synchronized.
- Custom interactions should expose a narrow typed API and preserve pointer capture, keyboard access, focus handling, Escape cancellation, no-op behavior, and one mutation commit per completed gesture.
- When extracting Angular components, explicitly choose the host's `display`, flex/grid participation, overflow, and stacking context so the DOM wrapper does not alter layout or overlays.

## Change quality

- Keep behavior-preserving refactors separate from product or visual changes.
- Add characterization coverage before moving risky pointer, keyboard, history, serialization, or animation behavior.
- Reuse existing CSS design tokens and document non-obvious z-index relationships.
- Remove superseded code and repository-wide references as part of the same change.
- Update `ARCHITECTURE.md` when ownership moves.

## Verification

For export or playback differences, capture an editable Project JSON and follow [`docs/RUNTIME_TESTING.md`](docs/RUNTIME_TESTING.md) to add an immutable editor/runtime parity fixture.

During feature work, run focused tests for the changed behavior and adjacent surfaces. For example:

```bash
npm test -- --watch=false --include='src/app/_services/selection-arrangement.spec.ts' --include='src/app/_services/tools/selection.interaction.spec.ts'
```

Run the production build and whitespace check at feature handoff. Reserve the full test suite for the final overhaul/release check, rather than repeating it for every small feature. Report which checks were run. Final verification:

```bash
npm test -- --watch=false
npm run build
git diff --check
```
